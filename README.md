# Promise Computer Research — Build 2

Build 2 adds the real customer layer to Build 1.

## Included
- Supabase authentication: register, login, logout, password reset
- Customer profile
- Protected customer dashboard
- My Orders page
- Customer order/status database
- Services database seeded from the public services
- Service fields foundation for future service-specific forms
- Notifications, support messages and private order-document schema
- Row Level Security policies for customer-owned data
- Private Supabase storage bucket for order documents
- Middleware session protection

## Not included yet
- Paystack checkout/webhooks
- Admin dashboard
- Admin role management UI
- Automated service APIs
- Customer document upload UI

Those belong to Build 3/4.

## Setup

1. Install Node.js 20+.
2. Run `npm install`.
3. Create a Supabase project.
4. Copy `.env.example` to `.env.local` and add your Supabase URL and anon/publishable key.
5. Open Supabase SQL Editor and run `supabase/schema.sql`.
6. In Supabase Authentication settings, configure your site URL and redirect URL for password recovery. For local development, use `http://localhost:3000`.
7. Run `npm run dev`.
8. Open `http://localhost:3000`.

## Important
The SQL schema uses customer-only RLS policies. Admin policies and admin UI are intentionally reserved for the next build. Do not disable RLS in production.

## Nifex live data-plan catalogue

The data request form uses the server route `/api/nifex/data-plans` and validates the selected plan and price again on the server before creating a paid order.

Required Vercel environment variables:
- `NIFEX_API_KEY` — Nifex API token (server-side only).
- `NIFEX_DATA_PLANS_PATH` — the exact relative GET path for listing active data plans, confirmed by Nifex support. Do not guess this path.
- `NIFEX_BASE_URL` — optional; defaults to `https://nifexdataapp.com.ng/api/`.

The API documentation supplied for this project documents `POST /data/` but does not document a data-plan listing endpoint. Until Nifex confirms the catalogue path and response schema, the plan selector intentionally reports that live plans are unavailable and checkout cannot proceed. This prevents customer-supplied plan IDs or prices from being trusted.
