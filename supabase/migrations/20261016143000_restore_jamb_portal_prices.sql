-- Restore the four requested JAMB portal/no-portal services with their exact prices.
-- The earlier cleanup retired these slugs when the catalogue was consolidated.
-- This migration intentionally reactivates only these four services.
begin;

update public.services
set title = 'JAMB Admission Letter — Portal Access',
    description = 'JAMB admission letter processing when you have access to your JAMB portal.',
    category = 'JAMB',
    price = 3000,
    price_type = 'fixed',
    active = true,
    sort_order = 15
where slug = 'jamb-admission-letter-portal';

update public.services
set title = 'JAMB Admission Letter — No Portal Access',
    description = 'JAMB admission letter processing when you do not have access to your JAMB portal.',
    category = 'JAMB',
    price = 4000,
    price_type = 'fixed',
    active = true,
    sort_order = 16
where slug = 'jamb-admission-letter-no-portal';

update public.services
set title = 'JAMB Original Result — Portal Access',
    description = 'JAMB original result processing when you have access to your JAMB portal.',
    category = 'JAMB',
    price = 2500,
    price_type = 'fixed',
    active = true,
    sort_order = 17
where slug = 'jamb-original-result-portal';

update public.services
set title = 'JAMB Original Result — No Portal Access',
    description = 'JAMB original result processing when you do not have access to your JAMB portal.',
    category = 'JAMB',
    price = 3500,
    price_type = 'fixed',
    active = true,
    sort_order = 18
where slug = 'jamb-original-result-no-portal';

-- Keep all four prices aligned even if a row was previously changed.
update public.services
set price = case slug
  when 'jamb-admission-letter-portal' then 3000
  when 'jamb-admission-letter-no-portal' then 4000
  when 'jamb-original-result-portal' then 2500
  when 'jamb-original-result-no-portal' then 3500
end,
price_type = 'fixed',
active = true
where slug in (
  'jamb-admission-letter-portal',
  'jamb-admission-letter-no-portal',
  'jamb-original-result-portal',
  'jamb-original-result-no-portal'
);

-- Repair existing unpaid/failed orders only. Never change the amount on paid orders.
update public.orders o
set amount = case s.slug
  when 'jamb-admission-letter-portal' then 3000
  when 'jamb-admission-letter-no-portal' then 4000
  when 'jamb-original-result-portal' then 2500
  when 'jamb-original-result-no-portal' then 3500
end
from public.services s
where o.service_id = s.id
  and s.slug in (
    'jamb-admission-letter-portal',
    'jamb-admission-letter-no-portal',
    'jamb-original-result-portal',
    'jamb-original-result-no-portal'
  )
  and lower(coalesce(o.payment_status, '')) in ('unpaid', 'failed');

commit;
