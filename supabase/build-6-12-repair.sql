-- Build 6.12 repair: JAMB/WAEC year options + Post-UTME service
-- Run once in Supabase SQL Editor.

update public.service_fields sf
set options='["2015","2016","2017","2018","2019","2020","2021","2022","2023","2024","2025","2026"]'::jsonb
from public.services s
where sf.service_id=s.id
  and sf.field_key='exam_year'
  and s.slug in (
    'jamb-original-result-portal',
    'jamb-original-result-no-portal',
    'jamb-admission-letter-portal',
    'jamb-admission-letter-no-portal',
    'jamb-reprinting',
    'jamb-olevel-screenshot',
    'jamb-email-phone-screenshot',
    'jamb-registration-number-retrieval',
    'jamb-indemnity-form',
    'waec-digital-certificate',
    'waec-original-certificate',
    'waec-examination-number-retrieval'
  );

insert into public.services
(slug,title,category,description,price_type,price,active,sort_order)
values (
 'post-utme-screening',
 'Post-UTME & Online Screening Applications',
 'Admissions',
 'Post-UTME and online screening application assistance. Set the institution-specific price in Admin → Services & Pricing when you are ready to accept online payment.',
 'request',null,true,1
)
on conflict (slug) do update set
 title=excluded.title,
 category=excluded.category,
 description=excluded.description,
 active=true,
 updated_at=now();

delete from public.service_fields
where service_id=(select id from public.services where slug='post-utme-screening');

insert into public.service_fields
(service_id,field_key,label,field_type,placeholder,required,options,sort_order)
select id,'institution','Institution','text','University / Polytechnic / College',true,null,1
from public.services where slug='post-utme-screening';

insert into public.service_fields
(service_id,field_key,label,field_type,placeholder,required,options,sort_order)
select id,'application_details','Application Details','textarea','Tell us the programme and any application information',true,null,2
from public.services where slug='post-utme-screening';