// deno-lint-ignore-file no-explicit-any
import QRCode from "npm:qrcode@1.5.3";

const ALLOWED_ORIGIN = "https://lumenno.weblar.app.br";
const ADMIN_EMAIL = "gd665742@gmail.com";
const FROM = "Lumenno <agendamento@weblar.app.br>";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ============================================================
// Carta de rituais — espelho do que roda no site (não confiar no cliente)
// ============================================================
type Tier = {
  id: string; name: string;
  priceMin: number; priceMax: number;
  durMin: number; durMax: number;
  discount: number;
  features: string[];
};
type Zone = { id: string; label: string; hasIntensity: boolean; tiers: Tier[] };

const ZONES: Zone[] = [
  { id: "corpo", label: "Corpo", hasIntensity: true, tiers: [
    { id: "corpo-basico", name: "Básico", priceMin: 36, priceMax: 48, durMin: 30, durMax: 45, discount: 0, features: ["Óleo neutro","Ambiente calmo","Toalhas quentes"] },
    { id: "corpo-pro", name: "Pro", priceMin: 56, priceMax: 72, durMin: 45, durMax: 60, discount: 0.10, features: ["Óleo essencial à escolha","Música ambiente","Toalhas quentes"] },
    { id: "corpo-promax", name: "Pro Max", priceMin: 80, priceMax: 104, durMin: 60, durMax: 75, discount: 0.10, features: ["Pedras mornas","Alongamento leve","Chá pós-sessão"] },
    { id: "corpo-elite", name: "Pro Max Elite", priceMin: 120, priceMax: 152, durMin: 75, durMax: 100, discount: 0.10, features: ["Sala privativa","Ritual completo com pedras quentes","Boas-vindas com chá especial"] },
  ]},
  { id: "cabeca", label: "Cabeça", hasIntensity: false, tiers: [
    { id: "cabeca-basico", name: "Básico", priceMin: 19, priceMax: 24, durMin: 10, durMax: 20, discount: 0, features: ["Shampoo Dove ou anticaspa","Água quente ou morna","Toalhinha"] },
    { id: "cabeca-pro", name: "Pro", priceMin: 30, priceMax: 38, durMin: 20, durMax: 30, discount: 0.10, features: ["Cafuné estendido","Óleo capilar nutritivo"] },
    { id: "cabeca-promax", name: "Pro Max", priceMin: 44, priceMax: 54, durMin: 30, durMax: 40, discount: 0.10, features: ["Massagem de couro cabeludo","Toalha aromática"] },
    { id: "cabeca-elite", name: "Pro Max Elite", priceMin: 60, priceMax: 76, durMin: 40, durMax: 55, discount: 0.10, features: ["Ritual completo de cabeça e nuca","Óleo premium","Ambiente reservado"] },
  ]},
  { id: "costas", label: "Costas", hasIntensity: false, tiers: [
    { id: "costas-basico", name: "Básico", priceMin: 28, priceMax: 32, durMin: 10, durMax: 20, discount: 0, features: ["Relaxing Base","Creme adicional disponível"] },
    { id: "costas-pro", name: "Pro", priceMin: 37, priceMax: 44, durMin: 20, durMax: 45, discount: 0.10, features: ["Relaxing Plus RMC","Creme adicional disponível"] },
    { id: "costas-promax", name: "Pro Max", priceMin: 48, priceMax: 60, durMin: 45, durMax: 70, discount: 0.10, features: ["True Spa","Creme Nívea incluso"] },
    { id: "costas-elite", name: "Pro Max Elite", priceMin: 68, priceMax: 88, durMin: 70, durMax: 100, discount: 0.10, features: ["Sessão estendida","Pedras mornas nas costas","Creme Nívea incluso"] },
  ]},
  { id: "pes", label: "Pés", hasIntensity: false, tiers: [
    { id: "pes-basico", name: "Básico", priceMin: 28, priceMax: 34, durMin: 10, durMax: 30, discount: 0, features: ["Neatly Feet","Limpeza e relaxamento","Creme Nívea"] },
    { id: "pes-pro", name: "Pro", priceMin: 38, priceMax: 46, durMin: 30, durMax: 45, discount: 0.10, features: ["Esfoliação leve","Creme Nívea"] },
    { id: "pes-promax", name: "Pro Max", priceMin: 52, priceMax: 64, durMin: 45, durMax: 60, discount: 0.10, features: ["Massagem plantar completa","Pedras mornas"] },
    { id: "pes-elite", name: "Pro Max Elite", priceMin: 70, priceMax: 84, durMin: 60, durMax: 80, discount: 0.10, features: ["Ritual completo de pés e canelas","Creme premium","Chá pós-sessão"] },
  ]},
];

const CREME_PRICE = 8;
const EXPRESS_FEE = 15;
const EXPRESS_MIN = 10;
const INTENSITY_MULT: Record<string, number> = { leve: 0.9, media: 1.0, intensa: 1.15 };
const INTENSITY_LABEL: Record<string, string> = { leve: "leve", media: "média", intensa: "intensa" };

const round2 = (v: number) => Math.round(v * 100) / 100;
const money = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");

function basePrice(tier: Tier, dur: number): number {
  if (dur < tier.durMin) return tier.priceMin * (dur / tier.durMin);
  const span = tier.durMax - tier.durMin || 1;
  return tier.priceMin + ((dur - tier.durMin) / span) * (tier.priceMax - tier.priceMin);
}

function ritualPrice(zone: Zone, tier: Tier, dur: number, intensity: string, creme: boolean): number {
  let p = basePrice(tier, dur);
  if (zone.hasIntensity) p *= INTENSITY_MULT[intensity] ?? 1;
  p *= (1 - tier.discount);
  if (creme) p += CREME_PRICE;
  return round2(p);
}

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
// HTML builders
// ============================================================
function escHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c] as string));
}

type Item = {
  zoneId: string; tierId: string;
  zoneLabel: string; tierName: string;
  duration: number; intensity: string | null;
  creme: boolean; express: boolean;
  features: string[];
  price: number;
};

function itemLine(i: Item): string {
  const bits: string[] = [`${i.duration} min`];
  if (i.intensity) bits.push(`intensidade ${INTENSITY_LABEL[i.intensity] ?? i.intensity}`);
  if (i.creme) bits.push("com creme aromático");
  if (i.express) bits.push("Express");
  return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #E6EDE8;color:#14302A">
      <div style="font-weight:600">${escHtml(i.zoneLabel)} ${escHtml(i.tierName)}</div>
      <div style="color:#4C635C;font-size:13px">${escHtml(bits.join(", "))}</div>
      <div style="color:#4C635C;font-size:13px;margin-top:2px">Inclui: ${escHtml(i.features.join(", "))}</div>
    </td>
    <td style="padding:8px 0;border-bottom:1px solid #E6EDE8;text-align:right;font-weight:600;color:#14302A;white-space:nowrap">${escHtml(money(i.price))}</td>
  </tr>`;
}

function buildSuggestions(items: Item[]): Array<{ zone: Zone; tier: Tier }> {
  const used = new Set(items.map(i => `${i.zoneId}|${i.tierId}`));
  const usedZones = new Set(items.map(i => i.zoneId));
  const first = items[0];
  const firstZone = ZONES.find(z => z.id === first.zoneId);
  if (!firstZone) return [];
  const firstTierIdx = firstZone.tiers.findIndex(t => t.id === first.tierId);
  if (firstTierIdx < 0) return [];
  const suggestions: Array<{ zone: Zone; tier: Tier }> = [];

  if (firstTierIdx + 1 < firstZone.tiers.length) {
    const t = firstZone.tiers[firstTierIdx + 1];
    const key = `${firstZone.id}|${t.id}`;
    if (!used.has(key)) {
      suggestions.push({ zone: firstZone, tier: t });
      used.add(key);
    }
  }

  const firstTierName = firstZone.tiers[firstTierIdx].name;
  for (const z of ZONES) {
    if (usedZones.has(z.id)) continue;
    const t = z.tiers.find(tt => tt.name === firstTierName);
    if (!t) continue;
    const key = `${z.id}|${t.id}`;
    if (used.has(key)) continue;
    suggestions.push({ zone: z, tier: t });
    break;
  }

  return suggestions.slice(0, 2);
}

function suggestionStartPrice(tier: Tier): number {
  return round2(tier.priceMin * (1 - tier.discount));
}

function recommendationCard(s: { zone: Zone; tier: Tier } | null): string {
  if (!s) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="background:#FFFFFF;border:1px solid #E6EDE8;border-radius:12px;padding:16px">
      <div style="font-family:'Bricolage Grotesque',Helvetica,Arial,sans-serif;font-weight:700;font-size:16px;letter-spacing:-.01em;color:#14302A">${escHtml(s.zone.label)} ${escHtml(s.tier.name)}</div>
      <div style="color:#4C635C;font-size:13px;margin-top:6px">${s.tier.durMin} a ${s.tier.durMax} min · a partir de ${escHtml(money(suggestionStartPrice(s.tier)))}</div>
      <div style="color:#4C635C;font-size:13px;margin-top:4px">Inclui: ${escHtml(s.tier.features.join(", "))}</div>
      <p style="margin:14px 0 0"><a href="https://lumenno.weblar.app.br/#carta" style="display:inline-block;background:#2F6B55;color:#FBFDFB;text-decoration:none;padding:9px 18px;border-radius:999px;font-weight:600;font-size:13px">Ver ritual</a></p>
    </td></tr>
  </table>`;
}

function recommendationsBlock(items: Item[]): string {
  const suggestions = buildSuggestions(items);
  if (!suggestions.length) return "";
  const [a, b] = [suggestions[0], suggestions[1] ?? null];
  return `<tr><td style="padding:28px 28px 8px">
    <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#4C635C;margin-bottom:12px">Recomendamos também</div>
    <table role="presentation" class="cards" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td class="rec-card" width="50%" valign="top" style="vertical-align:top;padding:0 6px 0 0">${recommendationCard(a)}</td>
        <td class="rec-card" width="50%" valign="top" style="vertical-align:top;padding:0 0 0 6px">${recommendationCard(b)}</td>
      </tr>
    </table>
  </td></tr>`;
}

function appointmentBlock(customer: {
  name: string; email: string; phone: string;
  time: string; location: string; notes: string;
}): string {
  const row = (k: string, v: string) => `<div style="font-size:14px;color:#14302A;margin-top:4px"><b style="color:#4C635C;font-weight:600">${k}:</b> ${escHtml(v)}</div>`;
  const parts = [
    row("Nome", customer.name),
    row("E-mail", customer.email),
    row("Telefone", customer.phone),
    row("Horário", customer.time),
  ];
  if (customer.location) parts.push(row("Local", customer.location));
  if (customer.notes) parts.push(row("Observações", customer.notes));
  return `<tr><td style="padding:20px 28px 8px">
    <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#4C635C;margin-bottom:8px">Agendamento</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E9F0EB;border-radius:12px">
      <tr><td style="padding:14px 16px">${parts.join("")}</td></tr>
    </table>
  </td></tr>`;
}

function nextStepsBlock(): string {
  return `<tr><td style="padding:20px 28px 8px">
    <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#4C635C;margin-bottom:8px">Próximos passos</div>
    <ol style="margin:0;padding-left:20px;color:#14302A;font-size:14px;line-height:1.65">
      <li>Pague o Pix pelo QR Code ou pelo código.</li>
      <li>Assim que o pagamento cair, o Gabriel confirma seu horário por e-mail ou WhatsApp.</li>
      <li>No dia, é só chegar no horário combinado.</li>
    </ol>
  </td></tr>`;
}

function pixCodeBlock(pixCode: string): string {
  return `<tr><td style="padding:20px 28px 8px">
    <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#4C635C;margin-bottom:8px">Pix copia e cola</div>
    <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#E9F0EB;color:#14302A;padding:12px;border-radius:10px;word-break:break-all;line-height:1.5">${escHtml(pixCode)}</div>
  </td></tr>`;
}

function orderAndQrBlock(items: Item[], fee: number, total: number): string {
  const rows = items.map(itemLine).join("");
  const feeRow = fee > 0 ? `<tr><td style="padding:8px 0;color:#4C635C;font-size:14px">Taxa Express</td><td style="padding:8px 0;text-align:right;color:#4C635C;font-size:14px">${money(fee)}</td></tr>` : "";
  return `<tr><td style="padding:24px 28px 8px">
    <table role="presentation" class="cols" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td class="col-l" width="60%" valign="top" style="vertical-align:top;padding:0 20px 0 0">
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#4C635C;margin-bottom:10px">Seu pedido</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${rows}
            ${feeRow}
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

function customerHtml(
  customer: {
    name: string; email: string; phone: string;
    time: string; location: string; notes: string;
  },
  items: Item[],
  fee: number,
  total: number,
  pixCode: string,
): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Você está a um passo de marcar sua massagem</title>
  <style>
    @media only screen and (max-width: 560px) {
      .col-l, .col-r, .rec-card {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
        box-sizing: border-box;
      }
      .col-r { padding-top: 20px !important; }
      .rec-card + .rec-card { padding-top: 12px !important; }
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
          Você está a um passo de marcar sua massagem
        </h1>
        <p style="margin:0;color:#4C635C;font-size:15px;line-height:1.5">
          Pague o Pix pelo QR Code ou pelo código copia e cola. Assim que o pagamento cair, sua massagem está marcada.
        </p>
      </td></tr>
      ${orderAndQrBlock(items, fee, total)}
      ${pixCodeBlock(pixCode)}
      ${appointmentBlock(customer)}
      ${nextStepsBlock()}
      ${recommendationsBlock(items)}
      <tr><td style="padding:24px 28px 28px;margin-top:8px;border-top:1px solid #E6EDE8;color:#4C635C;font-size:13px;line-height:1.55">
        <div>Lumenno, casa de rituais.</div>
        <div style="margin-top:4px">Dúvidas? É só responder este e-mail.</div>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

function adminHtml(customer: any, items: Item[], fee: number, total: number, pixCode: string): string {
  const rows = items.map(itemLine).join("");
  const feeRow = fee > 0 ? `<tr><td style="padding:8px 0;color:#4C635C">Taxa Express</td><td style="padding:8px 0;text-align:right;color:#4C635C">${money(fee)}</td></tr>` : "";
  const line = (k: string, v: string) => `<tr><td style="padding:4px 0;color:#4C635C;font-size:13px;width:110px">${k}</td><td style="padding:4px 0;font-size:14px">${escHtml(v || "—")}</td></tr>`;
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#F5F7F6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#14302A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;max-width:600px;width:100%;overflow:hidden;border:1px solid #E6EDE8">
      <tr><td style="padding:20px 24px 4px">
        <div style="font-size:12px;color:#4C635C;letter-spacing:.08em;text-transform:uppercase">Novo orçamento</div>
        <h1 style="margin:8px 0 6px;font-size:22px">${escHtml(customer.name || "Sem nome")} — ${money(total)}</h1>
      </td></tr>
      <tr><td style="padding:8px 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${line("Nome", customer.name)}
          ${line("E-mail", customer.email)}
          ${line("Telefone", customer.phone)}
          ${line("Horário", customer.time)}
          ${line("Local", customer.location)}
          ${line("Observações", customer.notes)}
        </table>
      </td></tr>
      <tr><td style="padding:14px 24px 4px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}${feeRow}
          <tr><td style="padding:12px 0 0;font-weight:700;font-size:18px;border-top:2px solid #14302A">Total</td>
              <td style="padding:12px 0 0;font-weight:700;font-size:18px;border-top:2px solid #14302A;text-align:right">${money(total)}</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:12px 24px 20px">
        <div style="font-size:12px;color:#4C635C;margin-bottom:6px">Pix copia e cola</div>
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#F5F7F6;color:#14302A;padding:10px;border-radius:8px;word-break:break-all">${escHtml(pixCode)}</div>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

function textLines(customer: any, items: Item[], fee: number, total: number, pixCode: string): string {
  const lines = items.map(i => {
    const bits: string[] = [`${i.duration} min`];
    if (i.intensity) bits.push(`intensidade ${INTENSITY_LABEL[i.intensity] ?? i.intensity}`);
    if (i.creme) bits.push("com creme");
    if (i.express) bits.push("Express");
    return `- ${i.zoneLabel} ${i.tierName} (${bits.join(", ")}) — ${money(i.price)}`;
  });
  return [
    "Novo orçamento Lumenno",
    "",
    `Nome: ${customer.name || "-"}`,
    `E-mail: ${customer.email || "-"}`,
    `Telefone: ${customer.phone || "-"}`,
    `Horário: ${customer.time || "-"}`,
    `Local: ${customer.location || "-"}`,
    `Observações: ${customer.notes || "-"}`,
    "",
    "Rituais:",
    ...lines,
    fee > 0 ? `Taxa Express: ${money(fee)}` : "",
    `Total: ${money(total)}`,
    "",
    "Pix copia e cola:",
    pixCode,
  ].filter(Boolean).join("\n");
}

// ============================================================
// Handler
// ============================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Método não permitido." });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "JSON inválido." }); }

  const customer = body?.customer ?? {};
  const itemsIn: any[] = Array.isArray(body?.items) ? body.items : [];

  const name = String(customer.name ?? "").trim();
  const email = String(customer.email ?? "").trim();
  const phone = String(customer.phone ?? "").trim();
  const time = String(customer.time ?? "").trim();
  const location = String(customer.location ?? "").trim();
  const notes = String(customer.notes ?? "").trim();

  if (!name || !phone || !time) return json(400, { ok: false, error: "Preencha nome, telefone e horário." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { ok: false, error: "E-mail inválido." });
  if (!itemsIn.length) return json(400, { ok: false, error: "Nenhum ritual na sessão." });
  if (itemsIn.length > 20) return json(400, { ok: false, error: "Sessão muito grande." });

  const items: Item[] = [];
  for (const raw of itemsIn) {
    const zone = ZONES.find(z => z.id === raw?.zoneId);
    if (!zone) return json(400, { ok: false, error: `Zona desconhecida: ${raw?.zoneId}` });
    const tier = zone.tiers.find(t => t.id === raw?.tierId);
    if (!tier) return json(400, { ok: false, error: `Nível desconhecido: ${raw?.tierId}` });

    const express = Boolean(raw?.express);
    const creme = Boolean(raw?.creme);
    const intensity = zone.hasIntensity
      ? (INTENSITY_MULT[String(raw?.intensity)] != null ? String(raw.intensity) : "media")
      : "media";

    const lo = express ? Math.min(EXPRESS_MIN, tier.durMin) : tier.durMin;
    const hi = tier.durMax;
    let dur = Number(raw?.duration);
    if (!Number.isFinite(dur)) return json(400, { ok: false, error: "Duração inválida." });
    dur = Math.max(lo, Math.min(hi, Math.round(dur)));

    const price = ritualPrice(zone, tier, dur, intensity, creme);

    items.push({
      zoneId: zone.id, tierId: tier.id,
      zoneLabel: zone.label, tierName: tier.name,
      duration: dur, intensity: zone.hasIntensity ? intensity : null,
      creme, express,
      features: tier.features,
      price,
    });
  }

  const sub = round2(items.reduce((s, i) => s + i.price, 0));
  const fee = items.some(i => i.express) ? EXPRESS_FEE : 0;
  const total = round2(sub + fee);

  if (total <= 0) return json(400, { ok: false, error: "Total inválido." });

  const pixKey = Deno.env.get("PIX_KEY");
  const pixName = Deno.env.get("PIX_NAME");
  const pixCity = Deno.env.get("PIX_CITY");
  if (!pixKey || !pixName || !pixCity) {
    return json(500, { ok: false, error: "Pix não configurado no servidor." });
  }

  const txid = makeTxid(10);
  const pixCode = buildPixCode({ key: pixKey, name: pixName, city: pixCity, amount: total, txid });

  const qrPng: Uint8Array = await QRCode.toBuffer(pixCode, { type: "png", margin: 1, width: 440 });
  const qrBase64 = uint8ToBase64(qrPng);

  try {
    await sendEmail({
      from: FROM,
      to: [email],
      reply_to: ADMIN_EMAIL,
      subject: "Você está a um passo de marcar sua massagem",
      html: customerHtml({ name, email, phone, time, location, notes }, items, fee, total, pixCode),
      attachments: [{
        filename: "pix-qr.png",
        content: qrBase64,
        content_type: "image/png",
        content_id: "pix-qr",
      }],
    });
  } catch (err) {
    console.error("Erro ao enviar e-mail do cliente:", err);
    return json(502, { ok: false, error: "Não conseguimos enviar o e-mail agora. Tente de novo em instantes." });
  }

  try {
    await sendEmail({
      from: FROM,
      to: [ADMIN_EMAIL],
      reply_to: email,
      subject: "Novo orçamento Lumenno",
      html: adminHtml({ name, email, phone, time, location, notes }, items, fee, total, pixCode),
      text: textLines({ name, email, phone, time, location, notes }, items, fee, total, pixCode),
    });
  } catch (err) {
    // cliente já recebeu — só loga
    console.error("Erro ao enviar e-mail do admin:", err);
  }

  return json(200, { ok: true, total, pix_code: pixCode });
});
