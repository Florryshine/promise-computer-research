-- Promise Computer Research - Build 2 database schema
-- Run this in Supabase SQL Editor.

create extension if not exists "pgcrypto";

do $$ begin
  create type public.user_role as enum ('customer','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum ('draft','pending','processing','needs_information','completed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum ('unpaid','pending','paid','failed','refunded');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role public.user_role not null default 'customer',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  category text not null,
  description text not null,
  price_type text not null default 'request' check (price_type in ('fixed','request')),
  price numeric(12,2),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_fields (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null default 'text',
  placeholder text,
  required boolean not null default true,
  options jsonb,
  sort_order integer not null default 0,
  unique(service_id, field_key)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  status public.order_status not null default 'pending',
  payment_status public.payment_status not null default 'unpaid',
  amount numeric(12,2) not null default 0,
  customer_note text,
  admin_note text,
  form_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_documents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  message text not null,
  from_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.raw_user_meta_data->>'phone')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- Safe repeated setup: replace triggers if they already exist.
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
drop trigger if exists services_updated_at on public.services;
create trigger services_updated_at before update on public.services for each row execute procedure public.set_updated_at();
drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at before update on public.orders for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.service_fields enable row level security;
alter table public.orders enable row level security;
alter table public.order_documents enable row level security;
alter table public.notifications enable row level security;
alter table public.support_messages enable row level security;

-- Drop/recreate policies so this script is rerunnable.
drop policy if exists "public can view active services" on public.services;
create policy "public can view active services" on public.services for select using (active = true);
drop policy if exists "public can view fields for active services" on public.service_fields;
create policy "public can view fields for active services" on public.service_fields for select using (exists (select 1 from public.services s where s.id = service_id and s.active = true));

drop policy if exists "users can view own profile" on public.profiles;
create policy "users can view own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "users can view own orders" on public.orders;
create policy "users can view own orders" on public.orders for select using (auth.uid() = customer_id);
drop policy if exists "users can create own orders" on public.orders;
create policy "users can create own orders" on public.orders for insert with check (auth.uid() = customer_id);

drop policy if exists "users can view own documents" on public.order_documents;
create policy "users can view own documents" on public.order_documents for select using (exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid()));

drop policy if exists "users can view own notifications" on public.notifications;
create policy "users can view own notifications" on public.notifications for select using (auth.uid() = user_id);
drop policy if exists "users can mark own notifications read" on public.notifications;
create policy "users can mark own notifications read" on public.notifications for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users can view own support messages" on public.support_messages;
create policy "users can view own support messages" on public.support_messages for select using (auth.uid() = user_id);
drop policy if exists "users can send support messages" on public.support_messages;
create policy "users can send support messages" on public.support_messages for insert with check (auth.uid() = user_id and from_admin = false);

-- Seed services. Prices intentionally remain null until the client confirms them.
insert into public.services (slug,title,category,description,price_type,sort_order) values
('post-utme-screening','Post-UTME & Online Screening','Admissions','Assistance with Post-UTME applications, online screening and related admission processes.','request',1),
('school-fees-acceptance-gst-ent','School Fees, Acceptance Fees & GST/ENT','School Services','Get assistance with school payments and related online academic transactions.','request',2),
('course-registration-clearance','Course Registration & Online Clearance','School Services','Support for course registration, online clearance and related student portals.','request',3),
('jamb-services','JAMB Services','JAMB','Support for Original Result, Admission Letter, CAPS, Reprinting and other JAMB services.','request',4),
('waec-neco-nabteb-cards','WAEC/NECO/NABTEB Scratch Cards','Examinations','Access examination result-checking cards and related assistance.','request',5),
('transcript-original-result','Transcript & Original Result Processing','Documents','Professional assistance with transcript and original-result processing requests.','request',6),
('assignments-projects-siwes','Assignments, Final Year Projects & SIWES/IT Reports','Academic Support','Academic support services for assignments, projects and SIWES/IT documentation.','request',7),
('state-of-origin-birth-certificate','State of Origin & Birth Certificate Processing','Documentation','Assistance with documentation-related processing requests.','request',8),
('property-services','Property Buying & Selling Services','Property','Support for property buying and selling enquiries in and around Ekpoma and beyond.','request',9)
on conflict (slug) do nothing;

-- Storage bucket for customer documents. Keep it private.
insert into storage.buckets (id,name,public) values ('order-documents','order-documents',false)
on conflict (id) do nothing;
