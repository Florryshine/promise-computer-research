-- Build 6.4: service-specific request fields
-- Run once in Supabase SQL Editor.
-- Uses the existing service_fields pipeline; no parallel form system.

delete from public.service_fields
where service_id in (select id from public.services where slug in (
 'jamb-original-result-portal','jamb-original-result-no-portal',
 'jamb-admission-letter-portal','jamb-admission-letter-no-portal',
 'jamb-reprinting','jamb-olevel-screenshot','jamb-email-phone-screenshot',
 'jamb-profile-code-retrieval','jamb-registration-number-retrieval','jamb-indemnity-form',
 'waec-digital-certificate','waec-original-certificate','waec-examination-number-retrieval',
 'waec-scratch-card','neco-scratch-card','nabteb-scratch-card',
 'post-utme-screening','school-fees-acceptance-gst-ent','course-registration-clearance',
 'dstv-subscription','gotv-subscription','startimes-subscription','electricity-bill','airtime-recharge',
 'state-of-origin-birth-certificate','assignments','final-year-project','transcript-certificate'
));

with fields(slug,field_key,label,field_type,placeholder,required,options,sort_order) as (
 values
 ('jamb-original-result-portal','jamb_reg_number','JAMB Registration Number','text','e.g. 12345678AB',true,null,1),
 ('jamb-original-result-portal','exam_year','Exam Year','select',null,true,'["2015","2016","2017","2018","2019","2020","2021","2022","2023","2024","2025","2026"]'::jsonb,2),
 ('jamb-original-result-no-portal','jamb_reg_number','JAMB Registration Number','text','e.g. 12345678AB',true,null,1),
 ('jamb-original-result-no-portal','full_name_on_jamb','Full Name on JAMB Profile','text','As registered with JAMB',true,null,2),
 ('jamb-original-result-no-portal','exam_year','Exam Year','select',null,true,'["2015","2016","2017","2018","2019","2020","2021","2022","2023","2024","2025","2026"]'::jsonb,3),

 ('jamb-admission-letter-portal','jamb_reg_number','JAMB Registration Number','text','e.g. 12345678AB',true,null,1),
 ('jamb-admission-letter-portal','exam_year','Exam Year','select',null,true,'["2015","2016","2017","2018","2019","2020","2021","2022","2023","2024","2025","2026"]'::jsonb,2),
 ('jamb-admission-letter-no-portal','jamb_reg_number','JAMB Registration Number','text','e.g. 12345678AB',true,null,1),
 ('jamb-admission-letter-no-portal','full_name_on_jamb','Full Name on JAMB Profile','text','As registered with JAMB',true,null,2),
 ('jamb-admission-letter-no-portal','exam_year','Exam Year','select',null,true,'["2015","2016","2017","2018","2019","2020","2021","2022","2023","2024","2025","2026"]'::jsonb,3),

 ('jamb-reprinting','jamb_reg_number','JAMB Registration Number','text','e.g. 12345678AB',true,null,1),
 ('jamb-reprinting','exam_year','Exam Year','select',null,true,'["2015","2016","2017","2018","2019","2020","2021","2022","2023","2024","2025","2026"]'::jsonb,2),
 ('jamb-olevel-screenshot','jamb_reg_number','JAMB Registration Number','text','e.g. 12345678AB',true,null,1),
 ('jamb-olevel-screenshot','exam_year','Exam Year','select',null,true,'["2015","2016","2017","2018","2019","2020","2021","2022","2023","2024","2025","2026"]'::jsonb,2),
 ('jamb-email-phone-screenshot','jamb_reg_number','JAMB Registration Number','text','e.g. 12345678AB',true,null,1),
 ('jamb-email-phone-screenshot','exam_year','Exam Year','select',null,true,'["2015","2016","2017","2018","2019","2020","2021","2022","2023","2024","2025","2026"]'::jsonb,2),
 ('jamb-profile-code-retrieval','phone_number','Phone Number Used for JAMB','tel','Phone number',true,null,1),
 ('jamb-profile-code-retrieval','email_used','Email Used for JAMB','email','Email address',false,null,2),
 ('jamb-registration-number-retrieval','full_name_on_jamb','Full Name Used for JAMB','text','Full name',true,null,1),
 ('jamb-registration-number-retrieval','phone_number','Phone Number Used for JAMB','tel','Phone number',true,null,2),
 ('jamb-registration-number-retrieval','exam_year','Exam Year','select',null,true,'["2015","2016","2017","2018","2019","2020","2021","2022","2023","2024","2025","2026"]'::jsonb,3),
 ('jamb-indemnity-form','jamb_reg_number','JAMB Registration Number','text','e.g. 12345678AB',true,null,1),
 ('jamb-indemnity-form','exam_year','Exam Year','select',null,true,'["2015","2016","2017","2018","2019","2020","2021","2022","2023","2024","2025","2026"]'::jsonb,2),

 ('waec-digital-certificate','examination_number','WAEC Examination Number','text','Examination number',true,null,1),
 ('waec-digital-certificate','exam_year','Exam Year','select',null,true,'["2015","2016","2017","2018","2019","2020","2021","2022","2023","2024","2025","2026"]'::jsonb,2),
 ('waec-digital-certificate','full_name','Full Name on Certificate','text','As registered for the exam',true,null,3),
 ('waec-original-certificate','examination_number','WAEC Examination Number','text','Examination number',true,null,1),
 ('waec-original-certificate','exam_year','Exam Year','select',null,true,'["2015","2016","2017","2018","2019","2020","2021","2022","2023","2024","2025","2026"]'::jsonb,2),
 ('waec-examination-number-retrieval','full_name','Full Name Used for WAEC','text','Full name',true,null,1),
 ('waec-examination-number-retrieval','exam_year','Exam Year','select',null,true,'["2015","2016","2017","2018","2019","2020","2021","2022","2023","2024","2025","2026"]'::jsonb,2),

 ('post-utme-screening','institution','Institution','text','University / Polytechnic / College',true,null,1),
 ('post-utme-screening','application_details','Application Details','textarea','Tell us the programme and any application information',true,null,2),
 ('school-fees-acceptance-gst-ent','institution','Institution','text','School name',true,null,1),
 ('school-fees-acceptance-gst-ent','student_id','Student ID / Matric Number','text','Student ID or matric number',true,null,2),
 ('course-registration-clearance','institution','Institution','text','School name',true,null,1),
 ('course-registration-clearance','student_id','Student ID / Matric Number','text','Student ID or matric number',true,null,2),

 ('dstv-subscription','smartcard_number','Smartcard Number','number','DStv smartcard number',true,null,1),
 ('dstv-subscription','package','Package','select',null,true,'["Padi","Yanga","Confam","Compact","Compact Plus","Premium"]'::jsonb,2),
 ('gotv-subscription','smartcard_number','IUC Number','number','GOtv IUC number',true,null,1),
 ('gotv-subscription','package','Package','select',null,true,'["Smallie","Jolli","Max","Supa"]'::jsonb,2),
 ('startimes-subscription','smartcard_number','Smartcard Number','number','StarTimes smartcard number',true,null,1),
 ('startimes-subscription','package','Package','select',null,true,'["Nova","Basic","Classic","Smart"]'::jsonb,2),
 ('electricity-bill','meter_number','Meter Number','number','Meter number',true,null,1),
 ('electricity-bill','meter_type','Meter Type','select',null,true,'["Prepaid","Postpaid"]'::jsonb,2),
 ('electricity-bill','amount','Amount (₦)','number','Amount to pay',true,null,3),
 ('airtime-recharge','network','Network','select',null,true,'["MTN","Airtel","Glo","9mobile"]'::jsonb,1),
 ('airtime-recharge','phone_number','Phone Number','tel','Number to recharge',true,null,2),
 ('airtime-recharge','amount','Airtime Amount (₦)','number','Amount',true,null,3),

 ('state-of-origin-birth-certificate','state','State','text','State of origin',true,null,1),
 ('assignments','course','Course / Subject','text','Course or subject',true,null,1),
 ('assignments','topic','Assignment Topic','textarea','Paste the topic or instructions',true,null,2),
 ('final-year-project','institution','Institution','text','School name',true,null,1),
 ('final-year-project','department','Department','text','Department',true,null,2),
 ('final-year-project','topic','Project Topic','textarea','Project topic or area',true,null,3),
 ('transcript-certificate','institution','Institution','text','School name',true,null,1),
 ('transcript-certificate','student_id','Student ID / Matric Number','text','Student ID or matric number',true,null,2)
)
insert into public.service_fields(service_id,field_key,label,field_type,placeholder,required,options,sort_order)
select s.id,f.field_key,f.label,f.field_type,f.placeholder,f.required,f.options,f.sort_order
from fields f join public.services s on s.slug=f.slug
on conflict(service_id,field_key) do update set
 label=excluded.label,field_type=excluded.field_type,placeholder=excluded.placeholder,
 required=excluded.required,options=excluded.options,sort_order=excluded.sort_order;