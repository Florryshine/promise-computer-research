-- Rename the customer-facing service from "Data Pins" to "Recharge Card PINs".
-- Remove legacy Nifex/provider plan-ID form fields that should never be customer inputs.
UPDATE public.services
SET title = 'Recharge Card PINs',
    description = 'Buy MTN, Airtel, Glo or 9mobile recharge card PINs. PIN and serial details are delivered in your order after Pairgate confirms the purchase.'
WHERE slug = 'data-pins';

DELETE FROM public.service_fields sf
USING public.services s
WHERE sf.service_id = s.id
  AND s.slug = 'data-pins'
  AND (
    lower(coalesce(sf.field_key, '')) LIKE '%nifex%'
    OR lower(coalesce(sf.field_key, '')) LIKE '%plan%id%'
    OR lower(coalesce(sf.label, '')) LIKE '%nifex%'
    OR lower(coalesce(sf.label, '')) LIKE '%plan id%'
  );
