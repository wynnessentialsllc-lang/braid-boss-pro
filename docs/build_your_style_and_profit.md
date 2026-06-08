# Build Your Style (AI consultation) + Profit & Hair-Cost tooling

Status: **Phase 1 shipped.** Phases 2–3 specced below.

This is the braider-native version of the "AI consultation" + "hair-cost
profitability" gaps surfaced in the competitor analysis. Two competitor
ideas (GlossGenius/Fresha AI, StyleSeat smart-pricing) collapse into one
spine here: a **costed style catalog** (services + variations + a hair/
supply recipe) that powers both a client-facing AI quote and a stylist-
facing profit view.

---

## Phase 1 — Stylist profit & $/hour readout ✅ (shipped)

- `app/lib/pricing-profit.ts` — pure, tested (`pricing-profit.test.ts`).
- Calculator (`app/page.tsx`) now shows a stylist-only **"Your profit"**
  card: take-home, **take-home per hour** (the metric that ranks styles),
  margin %, and **profit above the stylist's own wage**, with a warning
  when the price doesn't cover their time after materials.
- No schema change. The existing calculator already collected hair cost,
  overhead, hours, and hourly rate — Phase 1 just stops throwing the
  insight away.

---

## Phase 2 — Hair recipe + inventory auto-cost (the spine)

**Goal:** stop making braiders type hair cost by hand, and make profit
numbers real instead of estimated.

**Phase 2a shipped:**
- `app/lib/recipe-cost.ts` — pure, tested (`recipe-cost.test.ts`):
  `recipeCost`, `recipeCostFromInventory`, `lineFromInventoryItem`.
- Calculator: **"Build hair cost from inventory"** sheet — pick the
  packs/bundles a style uses (from `store.inventoryItems`, with unit
  costs), live-totals them, and one-tap sets the hair-cost field. The
  recipe is snapshotted onto saved quotes (`inputs.recipe`) and restored
  from quotes/presets on prefill.

**Phase 2b shipped:**
- **Auto-deduct:** the recipe now rides "Book it" → appointment
  (`handleConvertQuoteToAppt`, appointment form seed + PATCH save). When the
  appointment is marked completed, the existing **Materials-used sheet**
  (confirm-before-deduct) seeds from the appointment's recipe instead of
  guessing from the service's `default_materials`, then deducts via the
  existing `inventory_apply_movement` path. Reuses the deduction machinery
  rather than duplicating it, and keeps the stylist's confirm step.
- **Most-profitable-styles report:** `rankStyleProfitability`
  (tested in `pricing-profit.test.ts`) + a calculator card ranking saved
  presets by take-home per hour (with margin), highest first.

**Phase 2 complete.**
- Recipe field added to the **style-preset editor** (auto-fills hair cost;
  recipes saved on a preset ride into the calculator + Book-it deduction).

- **Data:** a `service_recipe` concept — per service (or per variation),
  a list of `{ inventory_item_id, quantity }`. "Medium Boho Knotless →
  2× braiding hair, 2× human bundle."
- **Auto-cost:** in the calculator, a "Build from inventory" action sums
  `quantity × inventory.unitCost` (already on `inventory_items`) into the
  `hairCost` field. Save the recipe onto the style preset so it auto-fills
  next time.
- **Auto-deduct:** on appointment completion, fire the existing
  `inventory_apply_movement` RPC for the recipe so on-hand hair drops and
  low-stock alerts (already built) trigger restock.
- **Profitability report:** rank the catalog by margin and by $/hr in the
  existing analytics surface ("most/least profitable styles").

Reuses: `app/lib/inventory.ts` (unitCost, movements ledger),
`app/lib/services.ts` (variations + `resolveVariationPricing`), style
presets, analytics.

---

## Phase 3 — "Build your style" client flow (AI quote → approval → deposit)

For when a client doesn't see the style they want on the booking page.

### Client experience
1. On `/book/[slug]`: a **"Don't see your style? Build it here"** entry.
2. Client **uploads a photo**, answers a short structured intake:
   - Desired **size**
   - Desired **length**
   - **Hair included?** (stylist provides vs client brings)
   - **Human hair?**
   - **Color**
   - Free-text **important notes**
   - **Desired date & time** (reuse `preferred_date` / `preferred_time`)
3. **AI gives a ballpark quote** — closest matching service + estimated
   price range + estimated duration. Framed clearly as an *estimate,
   pending stylist review* (not a booking).
4. If interested, the client **submits the request to the stylist**.

### Stylist experience
5. Request lands in the **approval queue** (reuse existing booking-request
   approval workflow). Stylist sees the photo, intake answers, notes,
   desired date/time, and the AI's suggested service/price/duration.
6. Stylist **approves or denies**:
   - **Deny** → reason/notes sent to client (reuse denial email path).
   - **Approve** (optionally adjusting price/service/duration) → client
     gets an **approval notification with a deposit request to book**
     (reuse the deposit-first booking + Stripe Connect checkout path).

### How the AI works (technical)
- New route handler `app/api/style-consult/route.ts` (Next.js route
  handler — read `node_modules/next/dist/docs/` for the current route
  conventions before writing, per AGENTS.md).
- Uses the **Anthropic SDK** (`@anthropic-ai/sdk`), model
  **`claude-opus-4-8`**, **vision** input (the uploaded photo) +
  the structured intake, **structured output** (`output_config.format`)
  returning `{ styleFamily, suggestedServiceId, sizeGuess, lengthGuess,
  priceLow, priceHigh, estDurationHours, rationale }`.
- Price/duration are resolved against the existing service catalog
  (`resolveVariationPricing`) — the model picks the closest variation;
  pricing stays anchored to the stylist's real catalog, not invented.
- The quote is a **range** and always labeled "estimate · pending review."

### Data model (new)
- `style_requests` table: client contact, photo path (reuse
  `photo-storage`), intake JSON, `preferred_date`/`preferred_time`,
  AI suggestion snapshot, status
  (`ai_quoted → submitted → approved/denied → deposit_pending → booked`),
  stylist review notes, link to the resulting `booking_request` on
  approval.

### Dependencies / blockers
- **`ANTHROPIC_API_KEY` must be set in the deployment environment.** It is
  currently absent in the dev/CI container, so the AI route can be built
  and unit-tested with a mocked client, but **not verified end-to-end**
  until the key is configured. The route must degrade gracefully (clear
  "consultation temporarily unavailable" message) when the key is missing.

### Reuse summary
Approval queue, denial emails, deposit-first booking, Stripe Connect
checkout, booking-request `preferred_date`/`preferred_time`, photo
storage, service catalog + variation pricing — all already exist. Net-new
is the AI route, the `style_requests` table, and the client build-a-style
UI.

---

## Build order
1. ✅ Phase 1 — profit readout.
2. Phase 2 — `service_recipe` + inventory auto-cost + profit report.
3. Phase 3a — `style_requests` table + client "Build your style" intake UI
   (no AI yet: collects photo/answers/date-time, submits to approval).
4. Phase 3b — AI quote endpoint (Anthropic SDK, behind the API key).
5. Phase 3c — stylist approve/deny → deposit request wiring.
