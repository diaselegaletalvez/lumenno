# Lumenno — Casa de Rituais

## O que mudou nessa versão
- Site totalmente redesenhado no estilo boutique (verde-erva, dourado, creme)
- Carta de rituais com 4 zonas (Corpo, Cabeça, Costas, Pés) em abas
- 4 níveis por zona (Básico, Pro, Pro Max, Pro Max Elite) com desconto de 10% em Pro+
- Montagem de sessão: slider de duração, intensidade (só Corpo), creme aromático
- Favicon, apple-touch-icon e og-image (emblema botânico) em `assets/`
- Animações de entrada + reveal ao rolar a página
- Faixa de promoção no topo
- Campos de reserva: nome, telefone, horário, local, observações
- Botão "Falar com o Pedrão" (abre iMessage/SMS com gd665742@gmail.com)
- Webhook agora envia e-mail (via Resend) pro Pedrão quando um pagamento é confirmado — idempotente (não duplica em reenvios)

## Passo a passo

### 1. Banco de dados
Rode no SQL Editor do Supabase (ou via `supabase db push` com uma migration):
```
supabase/schema.sql
```
Se a tabela `orders` já existia (versão anterior), o script já inclui os `ALTER TABLE` para adicionar as novas colunas sem apagar nada.

### 2. Resend (e-mail pro Pedrão)
1. Crie uma conta em https://resend.com com o e-mail `gd665742@gmail.com`
2. Pegue a API Key em Resend → API Keys
3. Configure o secret:
```bash
supabase secrets set RESEND_API_KEY=sua_chave_aqui
```

> Nota: como o domínio `lumenno.app.br` ainda não foi registrado, os e-mails saem do remetente padrão do Resend (`onboarding@resend.dev`). Nesse modo, o Resend só permite mandar e-mail para o endereço da conta cadastrada — que é `gd665742@gmail.com`, exatamente o que precisamos. Quando registrar o domínio, dá pra migrar pro remetente `@lumenno.app.br`.

### 3. Deploy das Edge Functions
```bash
cd ~/projetos/lumenno
supabase functions deploy create-order --no-verify-jwt
supabase functions deploy infinitepay-webhook --no-verify-jwt
```

### 4. Deploy do site
```bash
git add .
git commit -m "Redesign boutique + montagem de sessão + notificação por e-mail"
git push
```

## Estrutura
- `index.html` — site completo (single page)
- `assets/emblem.svg`, `favicon-32.png`, `favicon-192.png`, `apple-touch-icon.png`, `og-image.png` — identidade visual
- `supabase/functions/create-order` — gera o checkout dinâmico na InfinitePay
- `supabase/functions/infinitepay-webhook` — confirma pagamento + envia e-mail
- `supabase/schema.sql` — tabela `orders`

## Próximos passos sugeridos
- Registrar `lumenno.app.br` e migrar o remetente de e-mail
- Cotação AwesomeAPI (USD→BRL) — combinamos deixar só em R$ por enquanto; se quiser adicionar depois, é uma chamada de API extra no create-order
