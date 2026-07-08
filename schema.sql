-- Tabela de pedidos do Lumenno (adiciona campos de horário/local/observações)
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_phone text not null,
  customer_time text,
  customer_location text,
  customer_notes text,
  items jsonb not null,
  total numeric(10,2) not null,
  status text not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table orders enable row level security;

-- Se a tabela já existe (você já rodou a versão anterior), rode isso também:
alter table orders add column if not exists customer_time text;
alter table orders add column if not exists customer_location text;
alter table orders add column if not exists customer_notes text;
