// supabase/functions/create-order/index.ts
// Cria um pedido no banco e gera um checkout dinâmico na InfinitePay.
import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const INFINITEPAY_HANDLE = Deno.env.get("INFINITEPAY_HANDLE")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const { customer, items, total } = await req.json();

    if (!customer?.name || !customer?.phone || !items?.length || !total) {
      return new Response(JSON.stringify({ error: "Dados incompletos." }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const orderId = crypto.randomUUID();
    const { error: insertError } = await supabase.from("orders").insert({
      id: orderId,
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_time: customer.time || null,
      customer_location: customer.location || null,
      customer_notes: customer.notes || null,
      items,
      total,
      status: "pending",
    });

    if (insertError) {
      console.error(insertError);
      return new Response(JSON.stringify({ error: "Erro ao salvar pedido." }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const checkoutItems = items.map((item: { name: string; price: number }) => ({
      name: item.name,
      price: Math.round(item.price * 100),
      quantity: 1,
    }));

    const params = new URLSearchParams({
      items: JSON.stringify(checkoutItems),
      order_nsu: orderId,
      redirect_url: "https://diaselegaletalvez.github.io/lumenno/",
    });

    const checkoutUrl = `https://checkout.infinitepay.io/${INFINITEPAY_HANDLE}?${params.toString()}`;

    return new Response(JSON.stringify({ checkout_url: checkoutUrl, order_id: orderId }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Erro inesperado." }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
