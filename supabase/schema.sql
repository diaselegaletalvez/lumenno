-- Lumenno — schema de contas, pedidos e pontos.
-- Idempotente: pode rodar várias vezes sem erro.

-- ============================================================
-- Tabela orders antiga (época da InfinitePay): se existir sem a coluna
-- user_id, é renomeada para orders_infinitepay_antigo. Nada é apagado.
-- ============================================================

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'orders'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'user_id'
  ) then
    alter table public.orders rename to orders_infinitepay_antigo;
    if exists (
      select 1 from pg_constraint
      where conname = 'orders_pkey'
        and conrelid = 'public.orders_infinitepay_antigo'::regclass
    ) then
      alter table public.orders_infinitepay_antigo
        rename constraint orders_pkey to orders_infinitepay_antigo_pkey;
    end if;
  end if;
end $$;

-- ============================================================
-- Tabelas
-- ============================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null default '',
  phone       text not null default '',
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.orders (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  items              jsonb not null,
  subtotal           numeric(10,2) not null,
  express_fee        numeric(10,2) not null default 0,
  total              numeric(10,2) not null,
  customer_time      text not null default '',
  customer_location  text not null default '',
  customer_notes     text not null default '',
  pix_txid           text,
  status             text not null default 'aguardando_pix'
                     check (status in ('aguardando_pix','pago','feita','cancelado')),
  points_awarded     int  not null default 0,
  created_at         timestamptz not null default now(),
  paid_at            timestamptz,
  done_at            timestamptz
);

create index if not exists orders_user_created_idx
  on public.orders (user_id, created_at desc);

create table if not exists public.points_ledger (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  order_id    uuid references public.orders(id) on delete set null,
  delta       int  not null,
  reason      text not null,
  created_at  timestamptz not null default now()
);

create index if not exists points_ledger_user_idx
  on public.points_ledger (user_id, created_at desc);

-- ============================================================
-- Trigger: cria profile e crédito de boas-vindas ao criar usuário
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'phone', '')
  )
  on conflict (id) do nothing;

  insert into public.points_ledger (user_id, delta, reason)
  values (new.id, 200, 'Bônus de boas-vindas');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Trigger: bloqueia alteração de is_admin por qualquer caller que
-- tenha auth.uid() (ou seja, clientes autenticados). A service role
-- não tem auth.uid() e passa normalmente.
-- ============================================================

create or replace function public.prevent_is_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and new.is_admin is distinct from old.is_admin then
    raise exception 'Alteração de is_admin não permitida.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_block_is_admin on public.profiles;
create trigger profiles_block_is_admin
  before update on public.profiles
  for each row execute function public.prevent_is_admin_change();

-- ============================================================
-- RLS
-- ============================================================

alter table public.profiles       enable row level security;
alter table public.orders         enable row level security;
alter table public.points_ledger  enable row level security;

-- profiles: lê e atualiza as próprias linhas (is_admin é bloqueado pelo trigger acima)
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select using (auth.uid() = id);

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- orders: só leitura das próprias linhas pelo cliente
drop policy if exists orders_self_select on public.orders;
create policy orders_self_select on public.orders
  for select using (auth.uid() = user_id);

-- points_ledger: só leitura das próprias linhas pelo cliente
drop policy if exists points_ledger_self_select on public.points_ledger;
create policy points_ledger_self_select on public.points_ledger
  for select using (auth.uid() = user_id);

-- ============================================================
-- RPC: saldo de pontos do usuário logado
-- ============================================================

create or replace function public.my_points()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(delta), 0)::int
  from public.points_ledger
  where user_id = auth.uid();
$$;

revoke all on function public.my_points() from public;
grant execute on function public.my_points() to authenticated;
