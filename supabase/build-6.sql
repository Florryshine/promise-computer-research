-- Build 6: expand the PCR catalogue to cover Nifex Data services.
-- Run once in Supabase SQL Editor. Existing services/orders are preserved.

insert into public.services
(slug,title,category,description,price_type,price,active,sort_order)
values
('data-subscription','Mobile Data','VTU','Buy mobile data for your network.','request',null,true,30),
('exam-pins','Exam Pins','VTU','Purchase available examination pins.','request',null,true,31),
('data-pins','Data Pins','VTU','Purchase data recharge pins.','request',null,true,32)
on conflict (slug) do update set
 title=excluded.title, category=excluded.category, description=excluded.description,
 price_type=excluded.price_type, active=true, sort_order=excluded.sort_order, updated_at=now();

-- Keep customer-facing service descriptions short and remove incorrect manual-fulfilment claims.
update public.services set description='Airtime top-up for your mobile network.', updated_at=now()
where slug='airtime-recharge';
update public.services set description='Mobile data bundles for your network.', updated_at=now()
where slug='data-subscription';
update public.services set description='DStv subscription and bouquet renewal.', updated_at=now()
where slug='dstv-subscription';
update public.services set description='GOtv subscription and package renewal.', updated_at=now()
where slug='gotv-subscription';
update public.services set description='StarTimes subscription and package renewal.', updated_at=now()
where slug='startimes-subscription';
update public.services set description='Electricity bill payment and meter top-up.', updated_at=now()
where slug='electricity-bill';
