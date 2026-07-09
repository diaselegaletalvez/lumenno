// supabase/functions/infinitepay-webhook/index.ts
// Recebe a notificação de pagamento da InfinitePay, atualiza o pedido (idempotente)
// e avisa o Pedrão por e-mail via Resend.
import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("INFINITEPAY_WEBHOOK_SECRET"); // opcional
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const NOTIFY_EMAIL = "gd665742@gmail.com";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const payload = await req.json();

    if (WEBHOOK_SECRET && payload.secret && payload.secret !== WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    const orderId = payload.order_nsu || payload.order_id;
    const isPaid = payload.status === "paid" || payload.paid === true;

    if (!orderId) {
      return new Response(JSON.stringify({ error: "order_nsu ausente." }), { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Busca o pedido atual antes de atualizar (checagem de idempotência)
    const { data: existingOrder, error: fetchError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (fetchError || !existingOrder) {
      console.error(fetchError);
      return new Response(JSON.stringify({ error: "Pedido não encontrado." }), { status: 404 });
    }

    const alreadyNotified = existingOrder.status === "paid";

    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: isPaid ? "paid" : "failed", paid_at: isPaid ? new Date().toISOString() : null })
      .eq("id", orderId);

    if (updateError) {
      console.error(updateError);
      return new Response(JSON.stringify({ error: "Erro ao atualizar pedido." }), { status: 500 });
    }

    // Só manda e-mail se o pagamento foi confirmado agora (evita duplicar em reenvios do webhook)
    if (isPaid && !alreadyNotified) {
      await notifyPedrao(existingOrder);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Erro inesperado." }), { status: 500 });
  }
});

async function notifyPedrao(order: any) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.map((item: any) => `
    <li>
      <strong>${item.name}</strong>
      ${item.duration ? ` — ${item.duration} min` : ""}
      ${item.intensity ? ` — Intensidade: ${item.intensity}` : ""}
      ${item.creme ? " — com creme aromático" : ""}
      — R$ ${Number(item.price).toFixed(2).replace(".", ",")}
    </li>
  `).join("");

  const html = `
    <h2>Novo pedido pago — Lumenno</h2>
    <p><strong>Cliente:</strong> ${order.customer_name}</p>
    <p><strong>Telefone:</strong> ${order.customer_phone}</p>
    <p><strong>Horário desejado:</strong> ${order.customer_time || "não informado"}</p>
    <p><strong>Local:</strong> ${order.customer_location || "não informado"}</p>
    <p><strong>Observações:</strong> ${order.customer_notes || "nenhuma"}</p>
    <h3>Rituais</h3>
    <ul>${itemsHtml}</ul>
    <p><strong>Total pago:</strong> R$ ${Number(order.total).toFixed(2).replace(".", ",")}</p>
    <p style="color:#888;font-size:12px;">Pedido #${order.id}</p>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Lumenno <onboarding@resend.dev>",
        to: [NOTIFY_EMAIL],
        subject: `Novo pedido pago — ${order.customer_name}`,
        html,
      }),
    });
    if (!res.ok) {
      console.error("Falha ao enviar e-mail:", await res.text());
    }
  } catch (err) {
    console.error("Erro ao enviar e-mail:", err);
  }
}
