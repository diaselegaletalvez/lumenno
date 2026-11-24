# Lumenno — Casa de Rituais

Site estático + Supabase (Auth + Postgres + Edge Function) + Resend.
O cliente cria conta, monta sua sessão, confirma por Pix e vê saldo de pontos e histórico de pedidos.

## Estrutura

```
index.html                           # site completo (single page)
assets/                              # favicons, apple-touch-icon, og-image, emblema
supabase/
  config.toml                        # verify_jwt=false para send-pix (checagem feita no código)
  schema.sql                         # tabelas, trigger de boas-vindas, RLS, RPC my_points
  functions/send-pix/index.ts        # edge function (exige login, grava pedido, envia Pix)
```

## Modelo de dados

- **profiles** — `id` (uuid, mesma chave de `auth.users`), `name`, `phone`, `is_admin` (default `false`, protegido por trigger), `created_at`.
- **orders** — `id`, `user_id`, `items` (jsonb), `subtotal`, `express_fee`, `total`, `customer_time`, `customer_location`, `customer_notes`, `pix_txid`, `status` (`aguardando_pix | pago | feita | cancelado`), `points_awarded`, timestamps.
- **points_ledger** — `id`, `user_id`, `order_id` (nullable), `delta`, `reason`, `created_at`. O saldo é a soma dos `delta` do usuário.
- **Trigger em `auth.users`** — ao criar um usuário, insere o `profile` (pegando `name` e `phone` de `raw_user_meta_data`) e lança **+200 pontos** com `reason = 'Bônus de boas-vindas'`.
- **RLS** — cliente só *lê* as próprias linhas das três tabelas. Pode *atualizar* `name` e `phone` no profile; qualquer tentativa de mudar `is_admin` é barrada por trigger. Nenhum `insert/update/delete` pelo cliente em `orders` e `points_ledger` (esses só são gravados pela função, com a service role).
- **RPC `my_points()`** — devolve o saldo do usuário logado.

## Aplicar o schema

Cole `supabase/schema.sql` no SQL Editor do projeto e rode. É idempotente — pode rodar de novo sem problema.

## Configuração do Auth (painel do Supabase)

Em **Authentication → URL Configuration**:

- **Site URL**: `https://lumenno.weblar.app.br`
- **Redirect URLs** (adicione todas):
  - `https://lumenno.weblar.app.br`
  - `https://lumenno.weblar.app.br/*`

Em **Authentication → Providers → Email**:

- **Enable email provider**: ligado
- **Confirm email**: **ligado** (o site exibe a tela "Confirme seu e-mail" após o cadastro)
- **Secure email change**: a gosto

Em **Authentication → Settings → Password**:

- **Minimum password length**: `6`
- Deixe tudo o mais desligado (sem exigência de maiúscula, número, símbolo).

Em **Authentication → Rate limits**: pode manter os padrões.

Os templates de e-mail (`Confirm signup`, `Reset password`) usam `{{ .ConfirmationURL }}` / `{{ .RedirectTo }}`. O site passa `emailRedirectTo = https://lumenno.weblar.app.br`, então o link do e-mail traz o visitante de volta já logado — a sessão de rituais fica salva no `localStorage` do navegador.

## Secrets da função send-pix

```bash
cd ~/projetos/lumenno

supabase secrets set \
  PIX_KEY="<a chave Pix, ex: gd665742@gmail.com>" \
  PIX_NAME="Gabriel Dias" \
  PIX_CITY="BRASILIA" \
  RESEND_API_KEY="<sua chave do Resend>"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já são injetadas automaticamente nas edge functions, não precisa setar.

Observações:
- `PIX_NAME` até 25 caracteres, `PIX_CITY` até 15, só ASCII.
- Remetente dos e-mails é `Lumenno <agendamento@weblar.app.br>` — o domínio `weblar.app.br` precisa estar verificado no Resend.

## Deploy da função

```bash
supabase functions deploy send-pix --no-verify-jwt
```

A função mantém `verify_jwt = false` em `config.toml` e faz a checagem do Bearer **no código** (chama `auth.getUser(token)` com a service role). Isso permite responder 401 com mensagem em português em vez do 401 cru do gateway.

## Chave pública do site

O site usa a chave `anon/publishable`. Para pegar via CLI:

```bash
supabase projects api-keys --project-ref wupkihqqcxlmgyjgfqwq
```

A constante `SUPABASE_KEY` em `index.html` já está preenchida com a chave publishable. A **service role** nunca aparece no site.

## Fluxo

1. Cliente abre o site. Monta rituais e preenche horário/local/observações — tudo fica salvo no `localStorage` (`lumenno.draft`) para não se perder entre visitas.
2. Clica **Entrar e confirmar** (ou, logado, **Confirmar orçamento**).
3. Se não estiver logado, abre o modal de conta:
   - **Criar conta**: nome, e-mail, telefone, senha (6+), confirmar senha. Depois do `signUp`, cai na tela **Confirme seu e-mail**, com botão **Reenviar e-mail**.
   - **Entrar**: e-mail + senha. Quem tentar entrar antes de confirmar vê a mesma tela de confirmação com o botão de reenviar.
   - **Esqueci minha senha**: envia o link de redefinição; clicando no e-mail, cai na tela **Criar senha nova**.
4. Depois de ativar/entrar, a modal fecha e o visitante volta para a sessão exatamente como estava.
5. O submit faz `POST /functions/v1/send-pix` com `Authorization: Bearer <access_token>` e só o `customer: { time, location, notes }` + `items` (sem preço). A função:
   - Valida o token, pega `name/phone` do profile e `email` de `auth.users`;
   - Recalcula subtotal, taxa Express e total;
   - Insere a `order` com `status='aguardando_pix'`, `pix_txid` e o `items` recalculado;
   - Dispara os e-mails do Resend (cliente + admin);
   - Devolve `{ ok, total, pix_code, order_id }`.
6. O site mostra QR Code, copia-e-cola e o botão **Copiar código Pix**.
7. Em **Minha conta** (chip no topo): saldo de pontos, barra "Faltam X pontos para o próximo prêmio" (Cabeça/Costas/Pés/Corpo Básico), histórico dos últimos pedidos (data, rituais, total, status em pt-BR) e **Sair**.

**Nesta etapa (1 de 3) os pontos ainda não são creditados por pedido.** A função deixa `points_awarded = 0` e não grava nada em `points_ledger` além do bônus de boas-vindas. O crédito vem na etapa 2, quando o pagamento for confirmado.

## Testar localmente

Edge function:
```bash
# terminal 1
cd ~/projetos/lumenno
# crie um ./supabase/.env.local com PIX_KEY, PIX_NAME, PIX_CITY, RESEND_API_KEY
supabase functions serve send-pix --no-verify-jwt --env-file ./supabase/.env.local
```

Para rodar o site apontando para a função local, troque temporariamente `SEND_PIX_URL` em `index.html` e adicione `http://localhost:8000` ao `ALLOWED_ORIGIN` em `supabase/functions/send-pix/index.ts`. Reverta antes do deploy. Em produção o CORS fica só para `https://lumenno.weblar.app.br`.

Site:
```bash
cd ~/projetos/lumenno
python3 -m http.server 8000
# http://localhost:8000
```

## O que ficou de fora

A InfinitePay saiu há tempos. As funções `create-order`, `infinitepay-webhook` e `admin-orders`, a pasta `admin/` e a tabela antiga `orders` não existem mais no repositório. Se ainda estão deployadas:

```bash
supabase functions delete create-order
supabase functions delete infinitepay-webhook
supabase functions delete admin-orders
```
