# Lumenno — Casa de Rituais

Site estático + uma edge function Supabase que recalcula o orçamento, gera o Pix (BR Code EMV estático) e dispara os e-mails pelo Resend.

## Estrutura

```
index.html                           # site completo (single page)
assets/                              # favicons, apple-touch-icon, og-image, emblema
supabase/
  config.toml                        # verify_jwt=false para send-pix
  functions/send-pix/index.ts        # edge function (recalcula total, Pix, Resend)
```

## Fluxo

1. Cliente monta a sessão no site (zonas, nível, tempo, intensidade, creme, express).
2. Ao clicar **Confirmar orçamento**, o site faz `POST` para `https://wupkihqqcxlmgyjgfqwq.supabase.co/functions/v1/send-pix` com o cliente e a lista de itens (sem preço).
3. A função recalcula o total no servidor (mesma tabela do site), gera o Pix copia e cola + QR Code (PNG) e envia dois e-mails pelo Resend:
   - Para o cliente: *"Você está a um passo de marcar sua massagem"*, com resumo, total, QR inline (via `cid:`) e o código copia e cola.
   - Para `gd665742@gmail.com`: *"Novo orçamento Lumenno"*, com todos os dados do cliente e do pedido.
4. A função responde `{ ok, total, pix_code }`. O site mostra o QR Code (gerado no cliente a partir do `pix_code`) e o botão **Copiar código Pix**.

A chave Pix **nunca** aparece no repositório — fica nos secrets do Supabase.

## Secrets necessários

```bash
cd ~/projetos/lumenno

supabase secrets set \
  PIX_KEY="<a chave Pix, ex: gd665742@gmail.com>" \
  PIX_NAME="Gabriel Dias" \
  PIX_CITY="BRASILIA" \
  RESEND_API_KEY="<sua chave do Resend>"
```

Observações:
- `PIX_NAME` até 25 caracteres, `PIX_CITY` até 15, só ASCII (a função normaliza, mas melhor já mandar limpo).
- O remetente dos e-mails é `Lumenno <agendamento@weblar.app.br>` — o domínio `weblar.app.br` precisa estar verificado no Resend.

## Deploy

```bash
supabase functions deploy send-pix --no-verify-jwt
```

O site é estático — o deploy continua sendo via `git push` para a branch que o GitHub Pages serve (hoje, `main`, com `CNAME` apontando para `lumenno.weblar.app.br`).

## Testar localmente

Edge function:
```bash
# terminal 1
cd ~/projetos/lumenno
# crie um ./supabase/.env.local com PIX_KEY, PIX_NAME, PIX_CITY, RESEND_API_KEY
supabase functions serve send-pix --no-verify-jwt --env-file ./supabase/.env.local

# terminal 2
curl -i -X POST http://localhost:54321/functions/v1/send-pix \
  -H 'Content-Type: application/json' \
  -d '{
    "customer": {
      "name": "Teste Cliente",
      "email": "voce@exemplo.com",
      "phone": "(61) 90000-0000",
      "time": "Sábado às 15h",
      "location": "", "notes": ""
    },
    "items": [
      { "zoneId":"costas", "tierId":"costas-pro", "duration":30, "intensity":null, "creme":false, "express":false }
    ]
  }'
```

A resposta deve ser `{ "ok": true, "total": ..., "pix_code": "..." }` e os dois e-mails são enviados de verdade — cuidado, use um e-mail seu em `customer.email`.

Site (só a UI):
```bash
cd ~/projetos/lumenno
python3 -m http.server 8000
# abre http://localhost:8000
```

Para testar o fluxo inteiro no navegador apontando para a função local, troque `SEND_PIX_URL` em `index.html` para `http://localhost:54321/functions/v1/send-pix` e inclua temporariamente `http://localhost:8000` em `ALLOWED_ORIGIN` em `supabase/functions/send-pix/index.ts`. Lembre de reverter antes de fazer deploy — em produção o CORS fica liberado só para `https://lumenno.weblar.app.br`.

## O que ficou de fora

A InfinitePay saiu. As funções `create-order`, `infinitepay-webhook` e `admin-orders`, a pasta `admin/` e a tabela `orders` não são mais usadas e foram removidas do repo. Se ainda estão deployadas no projeto Supabase, apagar com:

```bash
supabase functions delete create-order
supabase functions delete infinitepay-webhook
supabase functions delete admin-orders
```
