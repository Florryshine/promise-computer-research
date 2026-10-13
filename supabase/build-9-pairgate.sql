-- Build 9: switch automated VTU provider defaults to Pairgate.
-- Existing transaction rows are intentionally preserved for audit/history.
-- Run once in the Supabase SQL Editor after deploying the Pairgate integration.

alter table if exists public.provider_transactions
  alter column provider set default 'pairgate';

alter table if exists public.vtu_transactions
  alter column provider set default 'pairgate';

alter table if exists public.vtu_products
  alter column provider set default 'pairgate';

update public.services
set description = case slug
  when 'airtime-recharge' then 'Airtime recharge through Pairgate. Select a network, recipient phone number and amount.'
  when 'data-subscription' then 'Mobile data bundles through Pairgate. Choose a network and available data plan.'
  else description
end
where slug in ('airtime-recharge', 'data-subscription');
