# Phase B12.0 — Contracts foundation reference

Reference companion to `supabase/migrations/20260528000000_phase_b12_contracts_foundation.sql`. This file documents lifecycle, RPC contracts, RLS posture, and the integration hooks that B12.1 (notification queue) will attach to. **It is documentation only — no behavior change. Treat the migration SQL as canonical for runtime semantics; treat this file as the explanation.**

## 1. Tables

| Table | Purpose | Key fields | RLS |
|---|---|---|---|
| `contract_templates` | Owner-managed reusable agreement templates | `template_type` enum, `attach_to_all_bookings`, `require_signature`, `require_initials` | Owner-only (4 policies) |
| `service_contract_templates` | M:N junction binding templates to services | `(service_id, contract_template_id)` UNIQUE | Owner-only (4 policies) |
| `booking_contracts` | Generated, signable agreement instance | `public_token` UNIQUE (anon address), `body_snapshot` (immutable text at gen-time), `status` enum | Owner-only (4 policies). **Anon access is exclusively via the security-definer token RPC** — never direct table access. |
| `communication_logs` | Delivery-tracking log; future home for queue-dispatched events | `channel` enum (email/sms/in_app/system), `message_type` text, `provider`, `provider_message_id`, `status` enum | Owner-only select+insert (2 policies). The signed/declined RPCs write through SECURITY DEFINER so anon clients can land system rows without authentication. |

Distinct from `public.communications` (older outbound-copy log; left untouched).

## 2. Contract lifecycle

```
              ┌──────────┐
              │ template │  (created in Settings → Contracts)
              └────┬─────┘
                   │ generate_booking_contracts()
                   ▼
              ┌──────────┐  anon hits /contract/<token>
   created    │ pending  │──────────────────────────────►┐
              └────┬─────┘                                │
                   │ get_public_contract_by_token()       │
                   ▼ auto-flip on first read              │
              ┌──────────┐                                │
              │  viewed  │                                │
              └────┬─────┘                                │
                   │                                      │
       sign_public_contract()      decline_public_contract()
                   │                                      │
                   ▼                                      ▼
              ┌──────────┐                          ┌──────────┐
              │  signed  │                          │ declined │
              └──────────┘                          └──────────┘

      Terminal-only (no future transitions):
      signed · declined · expired · voided
```

State guards inside the RPCs:
- `sign_public_contract` only accepts `pending | viewed`. Re-signing a `signed` row raises `contract_not_signable_in_state_signed`. Idempotent against client retries.
- `decline_public_contract` only accepts non-terminal states.
- `expires_at` enforced in the sign RPC — past-due rows raise `contract_expired`.
- `voided` is reserved for owner-initiated cancellation (no RPC yet; flip the column directly via the owner's authenticated CRUD policy).

## 3. RPC reference

### `get_public_contract_by_token(token_in text)`
- **Scope**: SECURITY DEFINER, granted to `anon` + `authenticated`.
- **Returns**: safe public surface (title, body snapshot, status, client name/email, signed timestamp, viewed timestamp, expires at, require_signature, require_initials, business_name, service_name, preferred_date, preferred_time).
- **Side effect**: on first read of a `pending` row, flips to `viewed` and stamps `viewed_at`. Subsequent reads are read-only.
- **Notification hook (B12.1)**: `viewed` transition should enqueue a `contract_viewed` system log row so the stylist's UI can show "Client opened your agreement". Currently the row write only happens implicitly via this RPC; the queue layer will add an explicit `enqueueLog` call inside.

### `sign_public_contract(token_in, signed_name_in, signature_text_in, initials_in, ip_address_in, user_agent_in)`
- **Scope**: SECURITY DEFINER, granted to `anon` + `authenticated`.
- **Returns**: the updated `booking_contracts` row.
- **Side effects**:
  1. Updates `status='signed'`, `signed_at=now()`, `signed_name`, `signature_text`, `initials`, `ip_address`, `user_agent`.
  2. Inserts a `communication_logs` row with `channel='system'`, `message_type='contract_signed'`.
- **Notification hook (B12.1)**: this is the **first** hook the queue will own. After the inline insert, the queue will also enqueue an outbound `contract_signed_owner_alert` email/SMS for the stylist. Existing inline insert stays (system-level proof); queue adds the outbound dispatch.

### `decline_public_contract(token_in, reason_in, ip_address_in, user_agent_in)`
- **Scope**: SECURITY DEFINER, granted to `anon` + `authenticated`.
- **Side effects**:
  1. Updates `status='declined'`, `declined_at=now()`, plus client metadata.
  2. Inserts `communication_logs` row with `message_type='contract_declined'`.
- **Notification hook (B12.1)**: same pattern — inline system log stays, queue layer adds owner-alert.

### `generate_booking_contracts(booking_request_id_in uuid)`
- **Scope**: SECURITY DEFINER, granted to `anon` + `authenticated`. Anon path needed because the public booking page calls this immediately after `public_submit_booking_request` lands.
- **Returns**: integer count of newly-inserted contracts.
- **Behavior**: pulls the booking_request row, finds matching templates (per-service join + `attach_to_all_bookings`), snapshots title + body, skips duplicates by `(booking_request_id, contract_template_id)`. Idempotent — safe to retry.
- **Notification hook (B12.1)**: after each insert, the queue will enqueue a `contract_invite` email/SMS to the client. Currently the stylist must copy/paste the link manually from the Approvals queue mini-card.

## 4. Future notification hooks (high-level)

These are the touchpoints B12.1's queue will subscribe to. **Do not implement here.** Listed so the contracts foundation's call sites are predictable.

| Event | Source | Recipient | Channels |
|---|---|---|---|
| `booking_request_created` | `public_submit_booking_request` | Owner | in_app (already) + email |
| `contract_generated` | `generate_booking_contracts` insert | Client | email (Resend), SMS (Twilio later) |
| `contract_viewed` | `get_public_contract_by_token` viewed-flip | Owner | in_app + optional email |
| `contract_signed` | `sign_public_contract` | Owner | in_app (already) + email + SMS |
| `contract_declined` | `decline_public_contract` | Owner | in_app + email |
| `contract_reminder` | scheduled (24h after generated, then 48h) | Client | email + SMS |
| `contract_expiring_soon` | scheduled (24h before `expires_at`) | Client | email + SMS |

Every event writes a `communication_logs` row regardless of channel (system rows have `channel='system'`). External-channel rows transition `queued → sent → delivered` (or `failed`).

## 5. Anon access surface

Anonymous clients can reach **only** these four functions:
- `get_public_contract_by_token` (read)
- `sign_public_contract` (write — signing)
- `decline_public_contract` (write — decline)
- `generate_booking_contracts` (write — called by the public booking submit)

No direct table SELECT/INSERT is granted to anon. All four functions are SECURITY DEFINER and tightly scope their writes to a single row keyed by either the public token or a known booking_request_id. RLS on the underlying tables remains owner-only.

## 6. Replay safety

Migration `20260528000000` is fully idempotent:
- `create table if not exists`
- `do $$ ... if not exists ... create policy` blocks
- `create or replace function` on RPCs
- `create index if not exists`

Production may at one point have had a drifted `generate_booking_contracts` body (referencing a non-existent `br_row.name` column); the canonical version from the migration was redeployed via `create or replace` on 2026-05-11. Migration file matches production state today.

## 7. Out of scope (intentional)

These are deferred to B12.1 and tracked in `docs/b12_1_notification_architecture.md`:
- Email/SMS dispatch
- Notification queue table + worker
- Service editor inline contract attach UI
- Client profile "Agreements" section
- Owner-side dedicated Communication Log screen
- Per-client opt-out persistence
- Twilio integration
