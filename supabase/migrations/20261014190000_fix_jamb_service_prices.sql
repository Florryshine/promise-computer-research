-- Keep the JAMB catalogue and existing unpaid zero-value JAMB orders aligned with the fixed ₦1,000 price.
-- Does not alter paid orders or any non-JAMB service.
update public.services
set price = 1000,
    price_type = 'fixed'
where upper(trim(coalesce(category, ''))) = 'JAMB'
  and slug <> 'jamb-services'
  and active = true;

update public.orders as o
set amount = 1000
from public.services as s
where o.service_id = s.id
  and upper(trim(coalesce(s.category, ''))) = 'JAMB'
  and s.slug <> 'jamb-services'
  and coalesce(o.amount, 0) <> 1000
  and lower(coalesce(o.payment_status, '')) in ('unpaid', 'failed');
