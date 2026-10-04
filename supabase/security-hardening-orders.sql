-- Promise Computer Research security hardening
-- Apply this once in the Supabase SQL Editor.
-- VTpass-specific fulfillment logic is intentionally left unchanged.

begin;

-- 1) Keep customer-created orders, but make the database authoritative for
-- non-VTU pricing. A browser/client must never be able to choose the price
-- of a normal fixed-price service.
create or replace function public.enforce_order_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_price numeric;
  v_price_type text;
  v_active boolean;
begin
  select slug, price, price_type, active
    into v_slug, v_price, v_price_type, v_active
  from public.services
  where id = new.service_id;

  if not found then
    raise exception 'Invalid service.';
  end if;

  if v_active is not true then
    raise exception 'This service is not currently available.';
  end if;

  -- VTU prices are intentionally calculated by the existing VTpass flow.
  -- Do not overwrite those dynamic amounts here.
  if v_slug not in ('airtime-recharge', 'data-subscription', 'dstv-subscription', 'electricity-bill') then
    if v_price_type = 'fixed' then
      new.amount := coalesce(v_price, 0);
    else
      -- Quote/manual-review services start at zero until an authorized
      -- server-side/admin action sets the final amount.
      new.amount := 0;
    end if;
  end if;

  -- Never allow a client to impersonate another customer.
  if auth.role() <> 'service_role' then
    new.customer_id := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_order_integrity on public.orders;
create trigger trg_enforce_order_integrity
before insert on public.orders
for each row execute function public.enforce_order_integrity();

-- 2) Prevent a normal authenticated client from changing financial/security-
-- sensitive order fields after creation. The existing UI can still update
-- harmless customer-facing fields through whatever RLS policies already exist.
create or replace function public.protect_order_financial_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    if new.customer_id is distinct from old.customer_id
       or new.service_id is distinct from old.service_id
       or new.reference is distinct from old.reference
       or new.amount is distinct from old.amount
       or new.status is distinct from old.status
       or new.payment_status is distinct from old.payment_status then
      raise exception 'Protected order fields cannot be changed by the customer.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_order_financial_fields on public.orders;
create trigger trg_protect_order_financial_fields
before update on public.orders
for each row execute function public.protect_order_financial_fields();

-- 3) Stop two concurrent payment-initialization requests from creating two
-- pending Paystack payments for the same order. The application already
-- handles a duplicate insert by returning the existing payment.
create unique index if not exists payments_one_pending_per_order
on public.payments (order_id)
where status = 'pending';

-- 4) Basic database-level sanity check for order amounts.
alter table public.orders
  drop constraint if exists orders_amount_nonnegative;

alter table public.orders
  add constraint orders_amount_nonnegative
  check (amount >= 0);

commit;
