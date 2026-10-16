-- Remove the legacy manual WAEC/NECO/NABTEB service from public listings
-- while preserving any historical orders, and rename the automated PIN service.
begin;

-- The automated Pairgate-backed exam PIN service keeps its existing slug and functionality.
update public.services
set title = 'Examination Pins',
    description = 'Purchase examination PINs for WAEC, NECO and NABTEB.',
    updated_at = now()
where slug = 'exam-pins';

-- Hide the separate legacy/manual combined service so customers only see the
-- automated Examination Pins service. Preserve its row for historical orders.
update public.services
set active = false,
    updated_at = now()
where slug <> 'exam-pins'
  and (
    (
      lower(coalesce(title, '')) like '%waec%'
      and lower(coalesce(title, '')) like '%neco%'
      and (
        lower(coalesce(title, '')) like '%nabteb%'
        or lower(coalesce(slug, '')) like '%nabteb%'
      )
    )
    or (
      lower(coalesce(slug, '')) like '%manual%'
      and (
        lower(coalesce(title, '')) like '%waec%'
        or lower(coalesce(title, '')) like '%neco%'
        or lower(coalesce(title, '')) like '%nabteb%'
      )
    )
  );

-- Verify the automated PIN service and any deactivated manual listing.
select slug, title, category, active
from public.services
where slug = 'exam-pins'
   or (
     active = false
     and lower(coalesce(title, '')) like '%waec%'
     and lower(coalesce(title, '')) like '%neco%'
     and lower(coalesce(title, '')) like '%nabteb%'
   )
order by slug;

commit;
