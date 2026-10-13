-- Promise Computer Research service catalogue cleanup
-- Run once in the Supabase SQL editor after deploying this branch.
-- This retires legacy duplicate service listings only; historical orders are preserved.

begin;

-- Pairgate now sells these exam PINs through the unified automatic Exam PIN service.
update public.services
set active = false
where slug in (
  'waec-scratch-card',
  'neco-scratch-card',
  'nabteb-scratch-card',
  'waec-pin',
  'neco-pin',
  'nabteb-pin',
  'waec-exam-pin',
  'neco-exam-pin',
  'nabteb-exam-pin'
);

-- Replace the old JAMB portal/no-portal variants with one manual service per task.
update public.services
set active = false
where slug in (
  'jamb-original-result-portal',
  'jamb-original-result-no-portal',
  'jamb-admission-letter-portal',
  'jamb-admission-letter-no-portal'
);

insert into public.services
  (slug, title, category, description, price, price_type, active, sort_order)
values
  ('jamb-original-result-printing',
   'JAMB Original Result Printing', 'JAMB',
   'Manual assistance with obtaining and printing your JAMB original result. Submit your registration number and exam year; we will confirm any additional requirements.',
   null, 'request', true, 10),
  ('jamb-admission-letter-printing',
   'JAMB Admission Letter Printing', 'JAMB',
   'Manual assistance with obtaining and printing your JAMB admission letter. Submit your registration number and exam year; we will confirm any additional requirements.',
   null, 'request', true, 20),
  ('jamb-admission-status-checking',
   'JAMB Admission Status Checking', 'JAMB',
   'Manual assistance checking your JAMB admission status. Submit your registration number and exam year.',
   null, 'request', true, 30),
  ('jamb-reprinting',
   'JAMB Slip Reprinting', 'JAMB',
   'Manual assistance with JAMB slip reprinting. Tell us which slip you need and provide the relevant registration details.',
   null, 'request', true, 40),
  ('jamb-olevel-screenshot',
   'JAMB O’Level Result Screenshot', 'JAMB',
   'Manual assistance obtaining a screenshot of the O’Level result linked to your JAMB profile.',
   null, 'request', true, 50),
  ('jamb-email-phone-screenshot',
   'JAMB Email and Phone Screenshot', 'JAMB',
   'Manual assistance with viewing the email address and phone number associated with your JAMB profile.',
   null, 'request', true, 60),
  ('jamb-profile-code-retrieval',
   'JAMB Profile Code Retrieval', 'JAMB',
   'Manual assistance retrieving your JAMB profile code. Submit the details requested on the service form.',
   null, 'request', true, 70),
  ('jamb-registration-number-retrieval',
   'JAMB Registration Number Retrieval', 'JAMB',
   'Manual assistance retrieving your JAMB registration number. Provide your full name and exam year.',
   null, 'request', true, 80),
  ('jamb-indemnity-form',
   'JAMB Indemnity Form Assistance', 'JAMB',
   'Manual assistance with JAMB indemnity form requirements and processing.',
   null, 'request', true, 90)
on conflict (slug) do update set
  title = excluded.title,
  category = excluded.category,
  description = excluded.description,
  price = excluded.price,
  price_type = excluded.price_type,
  active = excluded.active,
  sort_order = excluded.sort_order;

commit;
