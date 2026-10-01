-- Build 8: precise VTpass service records for Airtime, Data, DStv and IKEDC Electricity.
-- Run once in Supabase SQL Editor.

insert into public.services
(slug,title,category,description,price_type,price,active,sort_order)
values
('data-subscription','Data Subscription','Utilities','VTpass data subscription. Select a network and live data plan; the selected provider amount is paid through Paystack before automatic fulfillment.','request',null,true,29)
on conflict (slug) do update set
 title=excluded.title,category=excluded.category,description=excluded.description,
 price_type='request',price=null,active=true,updated_at=now();

update public.services
set price_type='request',price=null,active=true
where slug in ('airtime-recharge','dstv-subscription','electricity-bill');

delete from public.service_fields
where service_id in (select id from public.services where slug in ('airtime-recharge','data-subscription','dstv-subscription','electricity-bill'));

with fields(slug,field_key,label,field_type,placeholder,required,options,sort_order) as (
 values
 ('airtime-recharge','network','Network','select',null,true,'["MTN","Airtel","Glo","9mobile"]'::jsonb,1),
 ('airtime-recharge','phone_number','Phone Number','tel','08012345678',true,null,2),
 ('airtime-recharge','amount','Airtime Amount (₦)','number','Enter amount',true,null,3),

 ('data-subscription','network','Network','select',null,true,'["MTN","Airtel","Glo","9mobile"]'::jsonb,1),
 ('data-subscription','phone_number','Phone Number','tel','08012345678',true,null,2),

 ('dstv-subscription','smartcard_number','Smartcard Number','text','DStv smartcard number',true,null,1),
 ('dstv-subscription','subscription_type','Subscription Type','select',null,true,'[{"value":"change","label":"Change / New Bouquet"},{"value":"renew","label":"Renew Current Bouquet"}]'::jsonb,2),
 ('dstv-subscription','phone_number','Phone Number','tel','08012345678',true,null,3),

 ('electricity-bill','meter_number','Meter Number','text','Enter meter number',true,null,1),
 ('electricity-bill','meter_type','Meter Type','select',null,true,'[{"value":"prepaid","label":"Prepaid"},{"value":"postpaid","label":"Postpaid"}]'::jsonb,2),
 ('electricity-bill','phone_number','Phone Number','tel','08012345678',true,null,3),
 ('electricity-bill','amount','Electricity Amount (₦)','number','Enter amount',true,null,4)
)
insert into public.service_fields(service_id,field_key,label,field_type,placeholder,required,options,sort_order)
select s.id,f.field_key,f.label,f.field_type,f.placeholder,f.required,f.options,f.sort_order
from fields f join public.services s on s.slug=f.slug
on conflict(service_id,field_key) do update set
 label=excluded.label,field_type=excluded.field_type,placeholder=excluded.placeholder,
 required=excluded.required,options=excluded.options,sort_order=excluded.sort_order;

-- Provider mappings. Product variation codes for Data/DStv are fetched live from VTpass,
-- not hard-coded, because VTpass exposes the current catalogue through service-variations.
insert into public.vtu_products(service_id,provider,provider_service_id,variation_code,name,amount,metadata)
select s.id,'vtpass',x.provider_service_id,null,x.name,null,'{"dynamic_variations":true}'::jsonb
from (values
 ('airtime-recharge','mtn','MTN Airtime'),
 ('airtime-recharge','airtel','Airtel Airtime'),
 ('airtime-recharge','glo','Glo Airtime'),
 ('airtime-recharge','etisalat','9mobile Airtime'),
 ('data-subscription','mtn-data','MTN Data'),
 ('data-subscription','airtel-data','Airtel Data'),
 ('data-subscription','glo-data','Glo Data'),
 ('data-subscription','etisalat-data','9mobile Data'),
 ('dstv-subscription','dstv','DStv'),
 ('electricity-bill','ikeja-electric','Ikeja Electric')
) x(slug,provider_service_id,name)
join public.services s on s.slug=x.slug
on conflict (provider,provider_service_id,variation_code) do update set
 service_id=excluded.service_id,name=excluded.name,metadata=excluded.metadata,updated_at=now();
