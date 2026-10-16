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

## Pairgate VTU integration

Airtime and mobile-data fulfilment use the server-side Pairgate adapter in `lib/pairgate.ts`. The data request form loads plans through `/api/pairgate/data-plans`; the order-creation route fetches the catalogue again and derives the plan ID and provider price on the server rather than trusting the browser.

Required Vercel environment variables:
- `PAIRGATE_API_KEY` — Pairgate API key; server-side only, never use a `NEXT_PUBLIC_` prefix.
- `PAIRGATE_BASE_URL` — optional; defaults to `https://pairgate.com/api/v1`.
- `PAIRGATE_TEST_MODE` — defaults to `true`; requests use Pairgate's documented `/test` endpoints while true. Set explicitly to `false` in the production environment only after confirming test responses, configuring the webhook secret/URL, and approving live fulfilment. Orders created in test mode are not proof of a live provider purchase and require a deliberate retry after switching to live mode.

The integration currently automates airtime and data purchases. Cable TV, electricity, exam pins and data pins must remain unavailable for automatic fulfilment until their Pairgate-specific forms, verification/catalogue endpoints, and request fields have been implemented and tested. Paystack remains the customer payment gateway; Pairgate is the fulfilment provider.

Pairgate documentation: `https://pairgate.com/developers`.
