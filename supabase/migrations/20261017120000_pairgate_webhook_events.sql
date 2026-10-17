create table if not exists public.pairgate_webhook_events (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists pairgate_webhook_events_ref_idx
  on public.pairgate_webhook_events (reference_code) where processed_at is null;
alter table public.pairgate_webhook_events enable row level security;
