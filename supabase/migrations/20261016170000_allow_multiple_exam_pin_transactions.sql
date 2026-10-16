-- Pairgate exam PIN orders can create one provider_transactions row per PIN.
-- The legacy unique(order_id, provider) constraint incorrectly allows only one
-- Pairgate row per order, causing child PIN references to be rejected.
begin;
alter table public.provider_transactions
  drop constraint if exists provider_transactions_order_id_provider_key;
drop index if exists public.provider_transactions_order_id_provider_key;
create index if not exists provider_transactions_order_provider_idx
  on public.provider_transactions(order_id, provider);
commit;
