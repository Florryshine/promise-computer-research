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
