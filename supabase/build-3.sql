-- Promise Computer Research - Build 3 migration
-- Run this AFTER the existing Build 2 schema in Supabase SQL Editor.


drop policy if exists "users can create own orders" on public.orders;
create policy "users can create own orders" on public.orders
for insert with check (
  auth.uid() = customer_id
  and status = 'pending'
  and payment_status = 'unpaid'
  and amount = coalesce((select s.price from public.services s where s.id = service_id and s.active = true), 0)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  reference text unique not null,
  provider text not null default 'paystack',
  amount numeric(12,2) not null,
  currency text not null default 'NGN',
  status public.payment_status not null default 'pending',
  gateway_response text,
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_order_id_idx on public.payments(order_id);
create index if not exists payments_reference_idx on public.payments(reference);

alter table public.payments enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "admins can view all profiles" on public.profiles;
create policy "admins can view all profiles" on public.profiles
for select using (auth.uid() = id or public.is_admin());

drop policy if exists "admins can view all services" on public.services;
create policy "admins can view all services" on public.services
for select using (active = true or public.is_admin());

drop policy if exists "admins can manage services" on public.services;
create policy "admins can manage services" on public.services
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins can view service fields" on public.service_fields;
create policy "admins can view service fields" on public.service_fields
for select using (
  public.is_admin()
  or exists (select 1 from public.services s where s.id = service_id and s.active = true)
);

drop policy if exists "admins can manage service fields" on public.service_fields;
create policy "admins can manage service fields" on public.service_fields
for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins can view all orders" on public.orders;
create policy "admins can view all orders" on public.orders
for select using (auth.uid() = customer_id or public.is_admin());

drop policy if exists "admins can update orders" on public.orders;
create policy "admins can update orders" on public.orders
for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "users can view own payments" on public.payments;
create policy "users can view own payments" on public.payments
for select using (
  exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
);

drop policy if exists "admins can view all payments" on public.payments;
create policy "admins can view all payments" on public.payments
for select using (public.is_admin());

drop policy if exists "admins can update payments" on public.payments;
create policy "admins can update payments" on public.payments
for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins can view all documents" on public.order_documents;
create policy "admins can view all documents" on public.order_documents
for select using (public.is_admin() or exists (
  select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()
));

drop policy if exists "admins can view all notifications" on public.notifications;
create policy "admins can view all notifications" on public.notifications
for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "admins can create notifications" on public.notifications;
create policy "admins can create notifications" on public.notifications
for insert with check (public.is_admin());

drop policy if exists "admins can view all support messages" on public.support_messages;
create policy "admins can view all support messages" on public.support_messages
for select using (auth.uid() = user_id or public.is_admin());

drop policy if exists "admins can send support messages" on public.support_messages;
create policy "admins can send support messages" on public.support_messages
for insert with check (public.is_admin());

drop trigger if exists payments_updated_at on public.payments;
create trigger payments_updated_at before update on public.payments
for each row execute procedure public.set_updated_at();


-- Security hardening: customers must never be able to self-promote to admin.
create or replace function public.prevent_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = old.id and new.role is distinct from old.role then
    raise exception 'Profile role cannot be changed by the account owner';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_profile_role_change on public.profiles;
create trigger prevent_profile_role_change
before update on public.profiles
for each row execute procedure public.prevent_profile_role_change();

create unique index if not exists payments_one_pending_per_order_idx
on public.payments(order_id)
where status = 'pending';

