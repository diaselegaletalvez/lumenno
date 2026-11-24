// deno-lint-ignore-file no-explicit-any
import QRCode from "npm:qrcode@1.5.3";

const ADMIN_EMAIL = "gd665742@gmail.com";
const FROM = "Lumenno <agendamento@weblar.app.br>";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const round2 = (v: number) => Math.round(v * 100) / 100;
const money = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");

// ============================================================
// Pix BR Code (EMV estático) + CRC16 CCITT-FALSE
// ============================================================
function crc16(data: string): string {
  let crc = 0xFFFF;
  const bytes = new TextEncoder().encode(data);
  for (const ch of bytes) {
    crc ^= ch << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function tlv(id: string, value: string): string {
  const len = new TextEncoder().encode(value).length.toString().padStart(2, "0");
  return id + len + value;
}

function asciiSafe(s: string, max: number): string {
  return s.normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .\-]/g, "")
    .trim()
    .slice(0, max)
    .toUpperCase();
}

function makeTxid(len = 10): string {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) out += alpha[buf[i] % alpha.length];
  return out;
}

function buildPixCode({ key, name, city, amount, txid }: {
  key: string; name: string; city: string; amount: number; txid: string;
}): string {
  const merchantAccount = tlv("00", "BR.GOV.BCB.PIX") + tlv("01", key);
  const additionalData = tlv("05", txid);

  const payload =
    tlv("00", "01") +
    tlv("26", merchantAccount) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", amount.toFixed(2)) +
    tlv("58", "BR") +
    tlv("59", asciiSafe(name, 25)) +
    tlv("60", asciiSafe(city, 15)) +
    tlv("62", additionalData);

  const toCrc = payload + "6304";
  return toCrc + crc16(toCrc);
}

// ============================================================
// Resend
// ============================================================
function uint8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function sendEmail(payload: Record<string, any>) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("RESEND_API_KEY ausente nos secrets.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${txt}`);
  }
  return res.json();
}

// ============================================================
// HTML
// ============================================================
function escHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c] as string));
}

type InItem = { name: string; detail?: string; price: number };
type InGroup = { title: string; items: InItem[] };

function itemLine(i: InItem): string {
  const detail = i.detail
    ? `<div style="color:#4C635C;font-size:13px">${escHtml(i.detail)}</div>`
    : "";
  return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #E6EDE8;color:#14302A">
      <div style="font-weight:600">${escHtml(i.name)}</div>
      ${detail}
    </td>
    <td style="padding:8px 0;border-bottom:1px solid #E6EDE8;text-align:right;font-weight:600;color:#14302A;white-space:nowrap">${escHtml(money(i.price))}</td>
  </tr>`;
}

function groupBlock(g: InGroup): string {
  const rows = g.items.map(itemLine).join("");
  return `<div style="font-family:'Bricolage Grotesque',Helvetica,Arial,sans-serif;font-weight:700;font-size:16px;letter-spacing:-.01em;color:#14302A;margin:14px 0 4px">${escHtml(g.title)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
}

function orderAndQrBlock(groups: InGroup[], total: number): string {
  const blocks = groups.map(groupBlock).join("");
  return `<tr><td style="padding:24px 28px 8px">
    <table role="presentation" class="cols" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td class="col-l" width="60%" valign="top" style="vertical-align:top;padding:0 20px 0 0">
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#4C635C;margin-bottom:10px">Cobrança</div>
          ${blocks}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:14px 0 0;font-family:'Bricolage Grotesque',Helvetica,Arial,sans-serif;font-weight:700;font-size:20px;letter-spacing:-.02em;color:#14302A;border-top:2px solid #14302A">Total</td>
              <td style="padding:14px 0 0;font-family:'Bricolage Grotesque',Helvetica,Arial,sans-serif;font-weight:700;font-size:20px;letter-spacing:-.02em;color:#14302A;border-top:2px solid #14302A;text-align:right;white-space:nowrap">${money(total)}</td>
            </tr>
          </table>
        </td>
        <td class="col-r" width="40%" valign="top" style="vertical-align:top;text-align:center">
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#4C635C;margin-bottom:10px">Pague com Pix</div>
          <img src="cid:pix-qr" alt="QR Code do Pix" width="200" height="200" style="display:block;margin:0 auto;border-radius:12px;border:1px solid #E6EDE8;background:#fff;max-width:100%;height:auto">
          <p style="margin:10px 0 0;color:#4C635C;font-size:13px;line-height:1.45">Aponte a câmera do app do seu banco.</p>
        </td>
      </tr>
    </table>
  </td></tr>`;
}

function noteBlock(note: string): string {
  if (!note) return "";
  return `<tr><td style="padding:12px 28px 8px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF7E6;border:1px solid #F1E2B8;border-radius:12px">
      <tr><td style="padding:12px 14px;color:#6B5A1F;font-size:13px;line-height:1.5">${escHtml(note)}</td></tr>
    </table>
  </td></tr>`;
}

function pixCodeBlock(pixCode: string): string {
  return `<tr><td style="padding:20px 28px 8px">
    <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#4C635C;margin-bottom:8px">Pix copia e cola</div>
    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#E9F0EB;color:#14302A;padding:12px;border-radius:10px;word-break:break-all;line-height:1.5">${escHtml(pixCode)}</div>
  </td></tr>`;
}

function closingBlock(closing: string): string {
  if (!closing) return "";
  return `<tr><td style="padding:16px 28px 4px;color:#14302A;font-size:14px;line-height:1.6">${escHtml(closing)}</td></tr>`;
}

function emailHtml(
  heading: string,
  intro: string,
  groups: InGroup[],
  total: number,
  note: string,
  closing: string,
  pixCode: string,
): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escHtml(heading)}</title>
  <style>
    @media only screen and (max-width: 560px) {
      .col-l, .col-r {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
        box-sizing: border-box;
      }
      .col-r { padding-top: 20px !important; }
    }
  </style>
</head>
<body style="margin:0;background:#E9F0EB;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#14302A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E9F0EB;padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#FBFDFB;border-radius:16px;overflow:hidden;max-width:600px;width:100%">
      <tr><td style="padding:28px 28px 8px;border-bottom:1px solid #E6EDE8">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:middle;padding-right:12px">
              <img src="https://lumenno.weblar.app.br/assets/logo-email.png" width="44" height="44" alt="Lumenno" style="display:block">
            </td>
            <td style="vertical-align:middle;font-family:'Bricolage Grotesque',Helvetica,Arial,sans-serif;font-weight:700;font-size:22px;letter-spacing:-.02em;color:#14302A">
              Lumenno
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:24px 28px 4px">
        <h1 style="font-family:'Bricolage Grotesque',Helvetica,Arial,sans-serif;font-weight:700;font-size:28px;line-height:1.15;letter-spacing:-.02em;margin:0 0 10px;color:#14302A">
          ${escHtml(heading)}
        </h1>
        <p style="margin:0;color:#4C635C;font-size:15px;line-height:1.5">
          ${escHtml(intro)}
        </p>
      </td></tr>
      ${orderAndQrBlock(groups, total)}
      ${noteBlock(note)}
      ${pixCodeBlock(pixCode)}
      ${closingBlock(closing)}
      <tr><td style="padding:24px 28px 28px;margin-top:8px;border-top:1px solid #E6EDE8;color:#4C635C;font-size:13px;line-height:1.55">
        <div>Lumenno, casa de rituais.</div>
        <div style="margin-top:4px">Dúvidas? É só responder este e-mail.</div>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

// ============================================================
// Handler
// ============================================================
Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "Método não permitido." });

  const expected = Deno.env.get("COBRANCA_TOKEN");
  const got = req.headers.get("x-cobranca-token") ?? "";
  if (!expected || got !== expected) {
    return json(401, { ok: false, error: "Token inválido." });
  }

  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "JSON inválido." }); }

  const to = String(body?.to ?? "").trim();
  const subject = String(body?.subject ?? "").trim();
  const heading = String(body?.heading ?? "").trim();
  const intro = String(body?.intro ?? "").trim();
  const note = String(body?.note ?? "").trim();
  const closing = String(body?.closing ?? "").trim();
  const groupsIn: any[] = Array.isArray(body?.groups) ? body.groups : [];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return json(400, { ok: false, error: "Destinatário inválido." });
  if (!subject) return json(400, { ok: false, error: "subject obrigatório." });
  if (!heading) return json(400, { ok: false, error: "heading obrigatório." });
  if (!groupsIn.length) return json(400, { ok: false, error: "Nenhum grupo informado." });

  const groups: InGroup[] = [];
  for (const g of groupsIn) {
    const title = String(g?.title ?? "").trim();
    const itemsIn: any[] = Array.isArray(g?.items) ? g.items : [];
    if (!title) return json(400, { ok: false, error: "title do grupo obrigatório." });
    if (!itemsIn.length) return json(400, { ok: false, error: `Grupo "${title}" sem itens.` });
    const items: InItem[] = [];
    for (const it of itemsIn) {
      const name = String(it?.name ?? "").trim();
      const detail = String(it?.detail ?? "").trim();
      const price = Number(it?.price);
      if (!name) return json(400, { ok: false, error: "name do item obrigatório." });
      if (!Number.isFinite(price)) return json(400, { ok: false, error: `Preço inválido em "${name}".` });
      items.push({ name, detail, price: round2(price) });
    }
    groups.push({ title, items });
  }

  const total = round2(groups.reduce((s, g) => s + g.items.reduce((a, i) => a + i.price, 0), 0));
  if (total <= 0) return json(400, { ok: false, error: "Total inválido." });

  const pixKey = Deno.env.get("PIX_KEY");
  const pixName = Deno.env.get("PIX_NAME");
  const pixCity = Deno.env.get("PIX_CITY");
  if (!pixKey || !pixName || !pixCity) {
    return json(500, { ok: false, error: "Pix não configurado no servidor (PIX_KEY/PIX_NAME/PIX_CITY)." });
  }

  const txid = makeTxid(10);
  const pixCode = buildPixCode({ key: pixKey, name: pixName, city: pixCity, amount: total, txid });

  let qrBase64: string;
  try {
    const qrPng: Uint8Array = await QRCode.toBuffer(pixCode, { type: "png", margin: 1, width: 440 });
    qrBase64 = uint8ToBase64(qrPng);
  } catch (err) {
    return json(500, { ok: false, error: `Falha ao gerar QR: ${err instanceof Error ? err.message : String(err)}` });
  }

  try {
    await sendEmail({
      from: FROM,
      to: [to],
      bcc: [ADMIN_EMAIL],
      reply_to: ADMIN_EMAIL,
      subject,
      html: emailHtml(heading, intro, groups, total, note, closing, pixCode),
      attachments: [{
        filename: "pix-qr.png",
        content: qrBase64,
        content_type: "image/png",
        content_id: "pix-qr",
      }],
    });
  } catch (err) {
    return json(502, { ok: false, error: `Falha no envio: ${err instanceof Error ? err.message : String(err)}` });
  }

  return json(200, { ok: true, total, pix_code: pixCode });
});
