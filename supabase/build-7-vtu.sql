-- Build 7: VTpass integration foundation. Run once in Supabase SQL Editor.
-- No customer wallet. Paystack remains the customer payment gateway.

create table if not exists public.vtu_products (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.services(id) on delete set null,
  provider text not null default 'vtpass',
  provider_service_id text not null,
  variation_code text,
  name text not null,
  amount numeric(12,2),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, provider_service_id, variation_code)
);

create table if not exists public.vtu_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  product_id uuid references public.vtu_products(id) on delete set null,
  provider text not null default 'vtpass',
  request_id text unique not null,
  provider_transaction_id text,
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment','processing','delivered','pending','failed','reversed','refunded')),
  amount numeric(12,2) not null,
  service_fee numeric(12,2) not null default 0,
  target_data jsonb not null default '{}'::jsonb,
  provider_response jsonb not null default '{}'::jsonb,
  last_requery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vtu_transactions_status_idx on public.vtu_transactions(status);
create index if not exists vtu_transactions_provider_tx_idx on public.vtu_transactions(provider_transaction_id);

alter table public.vtu_products enable row level security;
alter table public.vtu_transactions enable row level security;

drop policy if exists "public can view active vtu products" on public.vtu_products;
create policy "public can view active vtu products" on public.vtu_products for select using (active = true);

drop policy if exists "users can view own vtu transactions" on public.vtu_transactions;
create policy "users can view own vtu transactions" on public.vtu_transactions
for select using (exists (select 1 from public.orders o where o.id=order_id and o.customer_id=auth.uid()));

-- Updated-at trigger is already present in the base schema.
drop trigger if exists vtu_transactions_updated_at on public.vtu_transactions;
create trigger vtu_transactions_updated_at before update on public.vtu_transactions
for each row execute procedure public.set_updated_at();

drop trigger if exists vtu_products_updated_at on public.vtu_products;
create trigger vtu_products_updated_at before update on public.vtu_products
for each row execute procedure public.set_updated_at();

-- Convert the old manually processed utility records into request services.
-- The VTU flow creates its own priced order after product selection.
update public.services
set price_type='request', price=null, description=case slug
  when 'dstv-subscription' then 'DStv subscription through VTpass. Select a bouquet and pay securely online.'
  when 'gotv-subscription' then 'GOtv subscription through VTpass. Select a bouquet and pay securely online.'
  when 'startimes-subscription' then 'StarTimes subscription through VTpass. Select a bouquet and pay securely online.'
  when 'electricity-bill' then 'Electricity bill payment through VTpass. Enter your meter details and amount.'
  when 'airtime-recharge' then 'Airtime recharge through VTpass. Select a network, phone number and amount.'
  else description end
where slug in ('dstv-subscription','gotv-subscription','startimes-subscription','electricity-bill','airtime-recharge');

-- Keep VTpass provider mapping in one place. Variations are synced from the provider later.
insert into public.vtu_products(service_id,provider,provider_service_id,variation_code,name,amount,metadata)
select s.id,'vtpass',x.service_id,x.variation_code,x.name,x.amount,'{}'::jsonb
from (values
 ('dstv-subscription','dstv',null,'DStv'),
 ('gotv-subscription','gotv',null,'GOtv'),
 ('startimes-subscription','startimes',null,'StarTimes'),
 ('electricity-bill','ikeja-electric',null,'Ikeja Electricity'),
 ('airtime-recharge','mtn',null,'MTN Airtime'),
 ('airtime-recharge','airtel',null,'Airtel Airtime'),
 ('airtime-recharge','glo',null,'Glo Airtime'),
 ('airtime-recharge','etisalat',null,'9mobile Airtime')
) x(slug,service_id,variation_code,name)
join public.services s on s.slug=x.slug
on conflict (provider,provider_service_id,variation_code) do update set name=excluded.name,service_id=excluded.service_id,updated_at=now();
