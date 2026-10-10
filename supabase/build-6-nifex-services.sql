-- Build 6: expose all services documented by Nifex Data
-- Run this file once in the Supabase SQL Editor.
-- Provider IDs and plan IDs are configured from the Nifex dashboard; no IDs are guessed here.

insert into public.services
(slug,title,category,description,price_type,price,active,sort_order)
values
('airtime-recharge','Airtime Recharge','Utilities','Recharge MTN, Airtel, Glo or 9mobile.','request',null,true,29),
('data-subscription','Mobile Data','Utilities','Buy mobile data for MTN, Airtel, Glo or 9mobile.','request',null,true,30),
('dstv-subscription','DStv Subscription','Subscriptions','Pay for your DStv package.','request',null,true,31),
('gotv-subscription','GOtv Subscription','Subscriptions','Pay for your GOtv package.','request',null,true,32),
('startimes-subscription','StarTimes Subscription','Subscriptions','Pay for your StarTimes package.','request',null,true,33),
('electricity-bill','Electricity Bill / Units','Utilities','Buy electricity units for a supported meter.','request',null,true,34),
('exam-pins','WAEC / NECO Exam Pins','Examinations','Purchase examination pins.','request',null,true,35),
('data-pins','Data Pins','Utilities','Generate data recharge pins.','request',null,true,36)
on conflict (slug) do update set
 title=excluded.title, category=excluded.category, description=excluded.description,
 price_type=excluded.price_type, price=excluded.price, active=excluded.active,
 sort_order=excluded.sort_order, updated_at=now();

-- Remove stale "manual" explanations from existing VTU service cards.
update public.services set description=case slug
 when 'airtime-recharge' then 'Recharge MTN, Airtel, Glo or 9mobile.'
 when 'data-subscription' then 'Buy mobile data for MTN, Airtel, Glo or 9mobile.'
 when 'dstv-subscription' then 'Pay for your DStv package.'
 when 'gotv-subscription' then 'Pay for your GOtv package.'
 when 'startimes-subscription' then 'Pay for your StarTimes package.'
 when 'electricity-bill' then 'Buy electricity units for a supported meter.'
 else description end,
 updated_at=now()
where slug in ('airtime-recharge','data-subscription','dstv-subscription','gotv-subscription','startimes-subscription','electricity-bill');

-- Rebuild the fields used by the dynamic order form for the Nifex services.
delete from public.service_fields
where service_id in (select id from public.services where slug in
 ('airtime-recharge','data-subscription','dstv-subscription','gotv-subscription','startimes-subscription','electricity-bill','exam-pins','data-pins'));

insert into public.service_fields (service_id,field_key,label,field_type,placeholder,required,options,sort_order)
select s.id, f.field_key, f.label, f.field_type, f.placeholder, f.required, f.options::jsonb, f.sort_order
from public.services s
cross join lateral (values
 ('airtime-recharge','network','Network','select',null,true,'[{"label":"MTN","value":"MTN"},{"label":"Airtel","value":"Airtel"},{"label":"Glo","value":"Glo"},{"label":"9mobile","value":"9mobile"}]',1),
 ('airtime-recharge','mobile_number','Phone number','tel','08012345678',true,null,2),
 ('airtime-recharge','amount','Airtime amount (₦)','number','100',true,null,3),
 ('airtime-recharge','airtime_type','Airtime type','select',null,true,'[{"label":"VTU","value":"VTU"}]',4),

 ('data-subscription','network','Network','select',null,true,'[{"label":"MTN","value":"MTN"},{"label":"Airtel","value":"Airtel"},{"label":"Glo","value":"Glo"},{"label":"9mobile","value":"9mobile"}]',1),
 ('data-subscription','mobile_number','Phone number','tel','08012345678',true,null,2),
 ('data-subscription','plan','Nifex data plan ID','number','Enter plan ID from Nifex',true,null,3),
 ('data-subscription','provider_amount','Data plan price (₦)','number','Enter the plan price',true,null,4),

 ('dstv-subscription','cablename','TV provider','select',null,true,'[{"label":"DStv","value":"dstv"}]',1),
 ('dstv-subscription','smart_card_number','Smartcard number','text','Enter smartcard number',true,null,2),
 ('dstv-subscription','cableplan','Nifex package ID','number','Enter package ID',true,null,3),
 ('dstv-subscription','provider_amount','Package price (₦)','number','Enter package price',true,null,4),

 ('gotv-subscription','cablename','TV provider','select',null,true,'[{"label":"GOtv","value":"gotv"}]',1),
 ('gotv-subscription','smart_card_number','Smartcard number','text','Enter smartcard number',true,null,2),
 ('gotv-subscription','cableplan','Nifex package ID','number','Enter package ID',true,null,3),
 ('gotv-subscription','provider_amount','Package price (₦)','number','Enter package price',true,null,4),

 ('startimes-subscription','cablename','TV provider','select',null,true,'[{"label":"StarTimes","value":"startimes"}]',1),
 ('startimes-subscription','smart_card_number','Smartcard number','text','Enter smartcard number',true,null,2),
 ('startimes-subscription','cableplan','Nifex package ID','number','Enter package ID',true,null,3),
 ('startimes-subscription','provider_amount','Package price (₦)','number','Enter package price',true,null,4),

 ('electricity-bill','disco','Electricity provider','select',null,true,'[{"label":"Ikeja Electric","value":"ikeja-electric"},{"label":"Eko Electric","value":"eko-electric"},{"label":"Abuja Electric","value":"abuja-electric"},{"label":"Kano Electric","value":"kano-electric"},{"label":"Ibadan Electric","value":"ibadan-electric"},{"label":"Enugu Electric","value":"enugu-electric"},{"label":"Port Harcourt Electric","value":"portharcourt-electric"},{"label":"Benin Electric","value":"benin-electric"},{"label":"Jos Electric","value":"jos-electric"},{"label":"Kaduna Electric","value":"kaduna-electric"}]',1),
 ('electricity-bill','meter_number','Meter number','text','Enter meter number',true,null,2),
 ('electricity-bill','meter_type','Meter type','select',null,true,'[{"label":"Prepaid","value":"prepaid"},{"label":"Postpaid","value":"postpaid"}]',3),
 ('electricity-bill','amount','Amount (₦)','number','2000',true,null,4),

 ('exam-pins','provider','Exam provider','select',null,true,'[{"label":"WAEC","value":"WAEC"},{"label":"NECO","value":"NECO"},{"label":"NABTEB","value":"NABTEB"}]',1),
 ('exam-pins','quantity','Quantity','number','1',true,null,2),
 ('exam-pins','amount','Total price (₦)','number','Enter total price',true,null,3),

 ('data-pins','network','Network','select',null,true,'[{"label":"MTN","value":"MTN"},{"label":"Airtel","value":"Airtel"},{"label":"Glo","value":"Glo"},{"label":"9mobile","value":"9mobile"}]',1),
 ('data-pins','data_plan','Data pin plan ID','number','Enter plan ID from Nifex',true,null,2),
 ('data-pins','quantity','Quantity','number','1',true,null,3),
 ('data-pins','amount','Total price (₦)','number','Enter total price',true,null,4)
) as f(slug,field_key,label,field_type,placeholder,required,options,sort_order) on f.slug=s.slug
where s.slug in ('airtime-recharge','data-subscription','dstv-subscription','gotv-subscription','startimes-subscription','electricity-bill','exam-pins','data-pins');

