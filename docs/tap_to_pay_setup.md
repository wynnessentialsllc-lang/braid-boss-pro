# Tap to Pay on iPhone — setup & App Review checklist

Apple granted Wynn Essentials, LLC the **Tap to Pay on iPhone** entitlement
(ProximityReader APIs, Case-ID **20421391**) with the *development
distribution restriction* — it works only on **registered test devices**
until Apple lifts the restriction. This doc covers what's wired into the
repo and the remaining Mac/Xcode steps to make the app review-ready.

Tap to Pay is implemented on top of **Stripe Terminal** (the app already
processes cards through Stripe Connect), so no second processor is involved.

---

## 1. What's already in the repo

| Layer | File | Status |
| --- | --- | --- |
| iOS entitlement | `ios/App/App/App.entitlements` | ✅ `com.apple.developer.proximity-reader.payment.acceptance` added |
| iOS Info.plist | `ios/App/App/Info.plist` | ✅ `NSLocationWhenInUseUsageDescription` added (Stripe Terminal requires it) |
| Native plugin | `ios/App/App/TapToPay/TapToPayPlugin.swift` + `.m` | ✅ source committed — **must be added to the Xcode target** (step 3) |
| Backend: connection token + location | `app/api/stripe-connect/terminal/token/route.ts` | ✅ |
| Backend: card-present PaymentIntent | `app/api/stripe-connect/terminal/intent/route.ts` | ✅ |
| Web bridge | `app/lib/taptopay.ts` | ✅ |
| In-app UI | `app/page.tsx` (appointment "In-person payment" card) | ✅ live "Tap to Pay" button, gated on device support |

**Safe to ship today:** the web + backend changes are inert until the
native plugin exists. `tapToPaySupported()` returns `false` on web/PWA and
on any native build without the plugin, so the UI falls back to the existing
"Tap to Pay soon" copy. Nothing breaks before step 3 is done.

---

## 2. Stripe configuration

- `STRIPE_SECRET_KEY` — already set; reused by the new routes.
- `PLATFORM_FEE_BPS` *(optional)* — same basis-points platform fee as the
  no-show / deposit flows; applied to the Tap to Pay PaymentIntent when > 0.
- **Terminal location** — created automatically on first use from the
  connected account's address (`/terminal/locations`). If the account has
  no address on file, the token route returns a clear error asking the
  stylist to add their business address in Stripe.
- The merchant's **connected account** must have **Tap to Pay / card_present
  Terminal capability** active. The **"Enable / check Tap to Pay"** button in
  `/settings/payments` requests the `card_present` capability and provisions
  a Terminal Location via `POST /api/stripe-connect/terminal/enable`, and
  reports ready / pending / inactive — it doubles as the probe for whether a
  Stripe support ticket is needed.

Apply migration `supabase/migrations/20261023000000_terminal_location.sql`
(adds `profiles.stripe_terminal_location_id`) so the provisioned Terminal
Location id is cached and reused instead of re-created each charge.

---

## 3. Xcode steps (must run on a Mac — cannot be done in CI/Linux)

1. **Add the Stripe Terminal SDK** to the `App` target via Swift Package
   Manager:
   - URL: `https://github.com/stripe/stripe-terminal-ios`
   - Dependency rule: **Up to Next Major** from `5.0.0` (min iOS 15).
   - Add the `StripeTerminal` product to the **App** target.

2. **Add the plugin sources to the `App` target.** In Xcode, add the
   `ios/App/App/TapToPay/` group (`TapToPayPlugin.swift` and
   `TapToPayPlugin.m`) to the App target's *Compile Sources*.

3. **Bridging header** (needed for the `.m` registration macro). If the App
   target has no Objective-C bridging header yet, add one
   (`App/App-Bridging-Header.h`) containing:
   ```objc
   #import <Capacitor/Capacitor.h>
   ```
   and point **Build Settings → Objective-C Bridging Header** at it. (Xcode
   offers to create one automatically the first time you add a `.m` file to
   a Swift target — accept it, then add the import.)

4. **Verify the entitlement is on the App ID / provisioning profile.** Apple
   enabled it for the grant; regenerate the profile so it includes
   *Tap to Pay on iPhone*. The key in `App.entitlements` must match or
   signing fails.

5. **Register test devices.** Because of the development distribution
   restriction, add the iPhones you'll demo/test on to the provisioning
   profile.

6. `npm run build:native` (`cap sync ios`) to refresh web assets, then build
   on a **physical iPhone XS or later** (Tap to Pay does not run in the
   Simulator).

---

## 4. On-device test checklist

- [ ] Sign in as a stylist whose Stripe account is connected.
- [ ] Open an appointment with a balance due → the card shows a gold
      **"Tap to Pay"** pill and a **"Tap to Pay $X"** button.
- [ ] Tap it → the system Tap to Pay sheet appears; accept the Terms of
      Service prompt the first time.
- [ ] Present a test card → on success the toast says "Charged $X. Tap Save
      to keep it," the method is set to **Tap to Pay**, and the PaymentIntent
      id is appended to payment notes.
- [ ] Save → appointment is marked paid and the charge shows in the Stripe
      Dashboard (and in Payments & Transactions).
- [ ] Cancelling the sheet leaves the appointment unpaid with no error toast.

---

## 5. App Review Requirements Checklist (v1.6) — audit

The in-app UX added for the publishing entitlement, mapped to the checklist
themes Apple reviews:

| Requirement | Where it lives | Notes |
| --- | --- | --- |
| **Awareness splash/banner** | `TapToPayAwareness` (one-time splash) | Shown once on a supported iPhone that hasn't enabled Tap to Pay; persisted via `bbp-ttp-aware-v1`. "Set up Tap to Pay" → settings; "Maybe later" dismisses. |
| **Settings → Payments → Tap to Pay enablement** | `TapToPayScreen` (`secondary === "tapToPay"`), reached from Settings → Payments → **Tap to Pay** row | Merchant opt-in toggle persisted on `business.tapToPayEnabled`; the checkout button is gated on it. |
| **Merchant education accessible later** | "How it works" expander in `TapToPayScreen` | Always reachable from Settings; step-by-step accept-a-payment guide. |
| **Configuration progress/status indicator** | Native `tapToPayStatus` events → progress UI in the appointment checkout card | Stages: Preparing → Connecting → Updating (with progress bar) → Ready → Present card → Processing. |
| **Readiness status** | Status card in `TapToPayScreen` | Live checks: device/iOS support, Stripe payments connected, Apple entitlement granted. |
| **Post-payment digital receipt options** | "Give your client a receipt?" prompt after a successful charge | Reuses the receipt builder + `ReceiptSheet` (text / email / share / PDF), or "No receipt". |
| **App Review video-ready flows** | Demo note in `TapToPayScreen` + the on-screen status indicator | Every state is reachable and demonstrable; see the demo script below. |

### Demo script (for the App Review video / notes)
1. Sign in as a stylist with Stripe connected.
2. Settings → Payments → **Tap to Pay** → toggle **on** (status card shows green checks).
3. Open an appointment with a balance due → **In-person payment** card shows the **Tap to Pay $…** button.
4. Tap it → status indicator runs (Preparing → Ready), the system Tap to Pay sheet appears (accept the Terms of Service the first time).
5. Present a test card → success toast, then the **digital receipt** prompt; choose text/email or skip; tap **Save**.

These behaviors degrade safely: on web/PWA and on native builds without the
plugin, the enablement row is hidden / the toggle has no effect and the
checkout falls back to the existing manual copy.

## 6. App Review notes

- Tap to Pay on iPhone apps are reviewed against Apple's **Tap to Pay on
  iPhone App Requirements** and the **App Review Requirements Checklist**
  (the two files in the Apple-provided Box folder referenced in the grant
  email). Re-read them before submitting; key recurring points:
  - The entitlement must be present and exercised by real functionality
    (the In-person payment button satisfies this).
  - Provide clear merchant-facing context for accepting in-person card
    payments (the card copy explains it).
- While the **development distribution restriction** is in place, the build
  is limited to registered test devices. Request removal from Apple when you
  intend to ship to the public App Store.
