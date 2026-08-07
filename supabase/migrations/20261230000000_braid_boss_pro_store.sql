-- Braid Boss Pro Store — first-party storefront.
--
-- Unlike the multi-tenant braider shops (/@handle/shop), this is Braid
-- Boss Pro's OWN store: braider essentials sold by the platform itself,
-- charged on the PLATFORM Stripe account (no Connect / no application
-- fee), fulfilled by us. The first product is a downloadable digital
-- planner for braiders.
--
-- The catalog itself lives in code (app/lib/store-catalog.ts) — it's a
-- small, curated, first-party set, so a typed config file is the source
-- of truth for prices, copy, images, and the digital file path. This
-- migration only adds the two pieces the catalog can't hold:
--
--   • store_orders   — one row per checkout, the record of a paid sale
--                      and the bearer token that authorizes a download.
--   • store-files    — PRIVATE storage bucket holding the actual
--                      downloadable files. Buyers never read it directly;
--                      /api/store-download mints a short-lived signed URL
--                      server-side after verifying the order is paid.
--
-- Mirrors the proven product_orders + product-files patterns
-- (20260619000000 / 20261225000000) so the first-party store shares the
-- platform's security posture: service-role writes only, no public read.

begin;

-- ── store_orders ─────────────────────────────────────────────────────
-- customer_token is a non-guessable bearer (same shape product_orders
-- uses): it appears in the success URL and the confirmation email and is
-- the only credential a buyer needs to fetch their download. Writes
-- happen exclusively through service-role API routes, so RLS is enabled
-- with NO policies for anon/authenticated (deny-by-default).
create table if not exists public.store_orders (
  id uuid primary key default gen_random_uuid(),
  -- Bearer token for the buyer's browser + email links. Defaulted here
  -- so the checkout route never has to mint it.
  customer_token text not null unique
    default lower(replace(gen_random_uuid()::text, '-', '')),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'cancelled')),
  -- Platform Stripe (no connected account) — no stripe_account_id column.
  stripe_session_id text unique,
  stripe_payment_intent text,
  buyer_email text,
  buyer_name text,
  currency text not null default 'usd',
  amount_total numeric(10, 2),
  -- Snapshot of what was bought: [{ slug, name, unit_amount, quantity,
  -- is_digital }]. The download route re-derives the file path from the
  -- live catalog (the authority), so no file paths are stored here.
  line_items jsonb not null default '[]'::jsonb,
  -- Set once, when the confirmation/delivery email is sent, so the
  -- webhook and the success-page confirm race to mark the order paid but
  -- only ONE of them ever sends the email.
  email_sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_orders_session_idx
  on public.store_orders (stripe_session_id);
create index if not exists store_orders_status_idx
  on public.store_orders (status, created_at desc);
create index if not exists store_orders_email_idx
  on public.store_orders (buyer_email, created_at desc);

alter table public.store_orders enable row level security;

-- Deny-by-default: no anon/authenticated policies. Every read and write
-- goes through the service role in the store API routes, which bypasses
-- RLS. This matches product_orders (writes are service-role only) but is
-- stricter on reads — a first-party order has no "owner" stylist to scope
-- a SELECT policy to; the buyer reads via the token-checking API instead.

-- ── store-files private bucket ───────────────────────────────────────
-- 200 MB per-object cap — digital planners are image-heavy PDFs and can
-- be large. PRIVATE: no public-read policy. The platform owner uploads
-- files via the Supabase dashboard (service role, unaffected by RLS);
-- buyers get a server-minted signed URL from /api/store-download.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'store-files', 'store-files', false, 209715200,
  array[
    'application/pdf',
    'application/epub+zip',
    'application/zip',
    'application/octet-stream'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = 209715200,
      allowed_mime_types = array[
        'application/pdf',
        'application/epub+zip',
        'application/zip',
        'application/octet-stream'
      ];

-- No storage policies: reads are service-role signed URLs, writes are the
-- dashboard (service role). Neither needs an anon/authenticated policy, so
-- the bucket stays fully locked to the public role.

commit;
