-- Build 5: Promise Computer Research real service catalogue and temporary pricing
-- Run once in Supabase SQL Editor.

insert into public.services
(slug,title,category,description,price_type,price,active,sort_order)
values
('post-utme-screening','Post-UTME & Online Screening Applications','Admissions','Post-UTME and online screening application assistance. Price depends on the institution; contact us on WhatsApp for the current fee.','request',null,true,1),
('school-fees-acceptance-gst-ent','School Fees, Acceptance Fees & GST/ENT','School Services','Assistance with school fees, acceptance fees and GST/ENT payments.','request',null,true,2),
('course-registration-clearance','Course Registration & Online Clearance','School Services','Course registration and online clearance assistance.','request',null,true,3),
('jamb-original-result-portal','JAMB Original Result — Portal Access','JAMB','Original JAMB result processing for candidates who can log in to their JAMB portal.','fixed',2500,true,4),
('jamb-original-result-no-portal','JAMB Original Result — No Portal Access','JAMB','Original JAMB result processing for candidates without JAMB portal access. Requirements: JAMB registration number, full name and exam year.','fixed',4500,true,5),
('jamb-admission-letter-portal','JAMB Admission Letter — Portal Access','JAMB','JAMB admission letter processing for candidates with portal access.','fixed',3000,true,6),
('jamb-admission-letter-no-portal','JAMB Admission Letter — No Portal Access','JAMB','JAMB admission letter processing for candidates without portal access. Requirements: JAMB registration number, full name and exam year.','fixed',4500,true,7),
('jamb-reprinting','JAMB Reprinting','JAMB','JAMB document reprinting assistance.','fixed',1000,true,8),
('jamb-olevel-screenshot','JAMB O''Level Result Screenshot','JAMB','JAMB O''Level result screenshot assistance.','fixed',1000,true,9),
('jamb-email-phone-screenshot','JAMB Email/Phone Number Screenshot','JAMB','JAMB profile email or phone number screenshot assistance.','fixed',1000,true,10),
('jamb-profile-code-retrieval','JAMB Profile Code Retrieval','JAMB','JAMB profile code retrieval service.','fixed',1000,true,11),
('jamb-registration-number-retrieval','JAMB Registration Number Retrieval','JAMB','JAMB registration number retrieval service.','fixed',1000,true,12),
('jamb-indemnity-form','Printing of JAMB Indemnity Form','JAMB','Printing assistance for JAMB indemnity forms.','fixed',1000,true,13),
('waec-digital-certificate','WAEC Digital Certificate','Examinations','WAEC digital certificate processing.','fixed',15000,true,14),
('waec-original-certificate','WAEC Original Certificate Process','Examinations','Assistance with WAEC original certificate processing.','request',null,true,15),
('waec-examination-number-retrieval','WAEC Examination Number Retrieval','Examinations','Assistance retrieving a WAEC examination number.','request',null,true,16),
('waec-scratch-card','WAEC Scratch Card','Examinations','WAEC result-checking scratch card.','fixed',7000,true,17),
('neco-scratch-card','NECO Scratch Card','Examinations','NECO result-checking scratch card.','fixed',3500,true,18),
('nabteb-scratch-card','NABTEB Scratch Card','Examinations','NABTEB result-checking scratch card.','fixed',2000,true,19),
('state-of-origin-birth-certificate','State of Origin & Birth Certificate Processing','Documentation','State of origin certificate and birth certificate processing. Contact us on WhatsApp to discuss requirements and price.','request',null,true,20),
('assignments','Assignments','Academic Support','Assignment support. Contact us on WhatsApp for requirements and pricing.','request',null,true,21),
('final-year-project','Final Year Project','Academic Support','Final year project support. Contact us on WhatsApp for requirements and pricing.','request',null,true,22),
('transcript-certificate','Transcript & Certificate Processing','Documents','Transcript and certificate processing. Contact us on WhatsApp for requirements and pricing.','request',null,true,23),
('nerd-registration','NERD Registration','School Services','NERD registration service.','request',null,false,24),
('dstv-subscription','DStv Subscription','Subscriptions','Manual DStv subscription processing. Enter your details and package plan; service charge is ₦1,000.','fixed',1000,true,25),
('gotv-subscription','GOtv Subscription','Subscriptions','Manual GOtv subscription processing. Enter your details and package plan; service charge is ₦1,000.','fixed',1000,true,26),
('startimes-subscription','StarTimes Subscription','Subscriptions','Manual StarTimes subscription processing. Enter your details and package plan; service charge is ₦1,000.','fixed',1000,true,27),
('electricity-bill','Electricity Bill / Units','Utilities','Manual electricity bill service. Enter the units you want and the amount; service charge is ₦500.','fixed',500,true,28),
('airtime-recharge','Airtime Recharge','Utilities','Airtime recharge processed manually. Final service charge and payment amount will be confirmed before processing.','request',null,true,29)
on conflict (slug) do update set
title=excluded.title, category=excluded.category, description=excluded.description,
price_type=excluded.price_type, price=excluded.price, active=excluded.active, sort_order=excluded.sort_order, updated_at=now();

-- Replace the old umbrella JAMB service so customers see the actual individual JAMB services.
update public.services set active=false, updated_at=now() where slug='jamb-services';
