# Tap to Pay on iPhone — Publishing Entitlement submission checklist

This is the production-readiness checklist for moving Braid Boss Pro from the
**development distribution restriction** (Apple Case-ID **20421391** —
registered test devices only) to the **publishing entitlement** that allows
public App Store distribution of Tap to Pay on iPhone.

- **App:** Braid Boss Pro · **Bundle ID:** `com.braidbosspro.app`
- **Processor:** Stripe Terminal (Tap to Pay on iPhone), on the merchant's
  connected Stripe account
- **Entitlement key:** `com.apple.developer.proximity-reader.payment.acceptance`
- Architecture: Next.js site in a Capacitor iOS shell; the native
  `TapToPay` plugin (`ios/App/App/TapToPay/`) wraps Stripe Terminal 5.x.

Companion docs: `docs/tap_to_pay_setup.md` (build + App Review checklist v1.6).

> Tap to Pay only runs on a **physical iPhone XS or later** on a recent iOS
> — never the Simulator. Everything below assumes a real device.

---

## 1. Xcode setup steps

- [ ] On a Mac with the latest stable Xcode, open `ios/App/App.xcodeproj`
      (or the workspace) and let Swift Package Manager resolve.
- [ ] **Add the Stripe Terminal SDK** to the **App** target via SPM:
      `https://github.com/stripe/stripe-terminal-ios`, rule **Up to Next
      Major** from `5.0.0`. Add the `StripeTerminal` product to the App target.
- [ ] **Add the plugin sources** to the App target's *Compile Sources*:
      `ios/App/App/TapToPay/TapToPayPlugin.swift` and `TapToPayPlugin.m`.
- [ ] **Objective-C bridging header**: ensure one exists for the App target
      importing `#import <Capacitor/Capacitor.h>` (Xcode offers to create one
      the first time a `.m` is added to a Swift target — accept, then add the
      import). Confirm **Build Settings → Objective-C Bridging Header** points
      at it.
- [ ] Confirm **`App.entitlements`** contains
      `com.apple.developer.proximity-reader.payment.acceptance = YES` and is
      set as the target's **Code Signing Entitlements**.
- [ ] Confirm **Info.plist** has `NSLocationWhenInUseUsageDescription`
      (Stripe Terminal requirement) and the existing camera/photo strings.
- [ ] Set a real **Team**, bump **Marketing Version** + **Build**, and select
      **Release** configuration.
- [ ] From the repo root run `npm install` then `npm run build:native`
      (`cap sync ios`) so the web assets + plugin list are current.
- [ ] Product → **Build** for a connected device; resolve any SDK symbol
      mismatches (Xcode autocomplete confirms the Tap to Pay delegate/setter
      names for the pinned SDK version).

## 2. Provisioning profile verification

- [ ] In the **Apple Developer portal → Identifiers**, open the App ID
      `com.braidbosspro.app` and confirm **Tap to Pay on iPhone** is checked
      under Capabilities (Apple enables this after granting the entitlement).
- [ ] Regenerate the **provisioning profiles** (Development **and**
      Distribution/App Store) so they include the Tap to Pay entitlement.
- [ ] In Xcode → Signing & Capabilities, verify **Tap to Pay on iPhone**
      appears as a capability and the selected profile is the regenerated one.
- [ ] Verify the signed build's entitlements:
      `codesign -d --entitlements :- <App>.app` shows
      `com.apple.developer.proximity-reader.payment.acceptance`.
- [ ] Confirm `aps-environment` matches the build (development for device
      testing; production for the App Store build).
- [ ] Distribution profile is **App Store** type (not Ad Hoc) for the final
      submission build.

## 3. Test device registration

- [ ] While the **development distribution restriction** is in place, every
      demo/test iPhone must be **registered** in the Developer portal
      (Devices) and included in the Development provisioning profile.
- [ ] Record each device's UDID, model (must be **iPhone XS or later**), and
      iOS version.
- [ ] Install the build on each registered device (Xcode run or Ad Hoc/
      TestFlight internal) and confirm it launches without a signing error.
- [ ] Confirm the device **region/locale** is one where Tap to Pay on iPhone
      + Stripe Terminal is supported.
- [ ] First launch on each device: the OS **"Try Tap to Pay on iPhone"** /
      Terms of Service acceptance appears on the first charge — capture which
      devices have already accepted.

## 4. Physical device test plan

Run on a registered iPhone XS+ signed into a stylist account with a fully
onboarded Stripe Connect account. Use Stripe **test cards / test mode** first,
then one **live** low-value transaction before submission.

| # | Scenario | Expected result |
|---|----------|-----------------|
| 1 | First-ever charge → accept Apple ToS | System ToS sheet appears once; after accepting, the reader prepares. |
| 2 | First-run reader software update | Status indicator shows **Updating** with a progress bar; completes to **Ready**. |
| 3 | Successful contactless card | Status runs Preparing → Ready → Present card → Processing; success toast "Charged $X"; appointment method = **Tap to Pay**, PI id in notes. |
| 4 | Apple Pay / wallet on a phone or watch | Same success path. |
| 5 | Declined card | Friendly error surfaced; appointment stays unpaid; no crash. |
| 6 | Cancel at the system sheet | Returns silently; appointment unchanged; no error toast. |
| 7 | Network drop mid-charge | Clear error; safe to retry; no double charge. |
| 8 | Two sequential charges in one session | Second charge reuses the connected reader (skips discovery). |
| 9 | Post-payment receipt | "Give your client a receipt?" → text/email/share/PDF works; "No receipt" dismisses. |
| 10 | Save after charge | Appointment marked paid; appears in Money / Payments & Transactions and in the Stripe Dashboard. |
| 11 | Refund the Tap to Pay charge | Refund from Payments & Transactions succeeds against the PI. |
| 12 | Enablement gate | With the toggle **off**, the checkout shows the fallback copy + "turn it on in Settings" — no Tap to Pay button. |
| 13 | Unsupported device / web | Tap to Pay row hidden on web; on an unsupported iPhone the status card explains why. |

- [ ] All 13 scenarios pass on at least one registered device.
- [ ] At least one **live-mode** transaction completed and refunded.

## 5. New User Flow — recording script

Record on-device (QuickTime mirror or screen recording). Narrate each step.

1. Launch the app → **welcome/intro** → tap **Get started**.
2. **Sign up** for a new stylist account; land on the dashboard.
3. (If shown) the **Tap to Pay on iPhone is here** awareness splash → tap
   **Set up Tap to Pay**.
4. On **Settings → Payments → Tap to Pay**: show the status card with
   **Stripe payments** not yet connected → tap **Set up Stripe payments** →
   complete Stripe Connect onboarding → return.
5. Back on the Tap to Pay screen: status card now shows green checks
   (iPhone & iOS, Stripe payments, Apple entitlement) → toggle **Accept Tap
   to Pay in this app** ON.
6. Expand **How it works** to show the merchant education.
7. Create/open an appointment with a balance due and complete one charge
   (see §7) to show end-to-end first-time success including the Apple ToS.

> Show: onboarding, the awareness splash, the enablement toggle flipping on,
> and a real first transaction.

## 6. Existing User Flow — recording script

1. Launch the app already signed in (Tap to Pay already enabled, Stripe
   connected) → land on dashboard.
2. Navigate to **Settings → Payments → Tap to Pay** to show the toggle is
   **On** and the status card is all green (steady state).
3. Open an existing appointment that has a balance due.
4. Run a charge via the **In-person payment** card (see §7).
5. Show the appointment now marked **paid** and the entry in **Payments &
   Transactions**.

> Show: a returning merchant taking a payment in a few taps with no setup.

## 7. Checkout Flow — recording script

The core transaction Apple most wants to see, start to finish:

1. Open an appointment with a balance due.
2. Scroll to **In-person payment** → tap **Tap to Pay $XX.XX**.
3. The on-screen **status indicator** shows: **Preparing → Connecting →
   (Updating with progress, first run only) → Ready**.
4. Apple's **system Tap to Pay sheet** appears (accept ToS on first run).
5. Hold a card / phone / watch near the top of the iPhone → indicator shows
   **Processing**.
6. **Success**: "Charged $XX.XX" toast.
7. **Digital receipt**: the "Give your client a receipt?" prompt → choose
   **Send receipt** (show the share/text/email options) or **No receipt**.
8. Tap **Save**; show the appointment flips to **paid**.
9. (Optional) Open the Stripe Dashboard to show the matching payment.

> Capture the full status progression and the system payment sheet — Apple
> looks for a clear, real card-present transaction.

## 8. Screenshots Apple will expect

- [ ] Awareness splash ("Tap to Pay on iPhone is here").
- [ ] Settings → Payments list showing the **Tap to Pay** row.
- [ ] Tap to Pay screen: enablement **toggle** + **status** card (all green).
- [ ] "How it works" merchant education expanded.
- [ ] Appointment **In-person payment** card with the **Tap to Pay $XX** button.
- [ ] On-screen **status/progress indicator** mid-transaction.
- [ ] The **system Tap to Pay sheet** (present-card screen).
- [ ] **Success** state ("Charged $XX").
- [ ] **Digital receipt** prompt / sent receipt.
- [ ] Payments & Transactions ledger showing the Tap to Pay charge.

> Use a real device at App Store screenshot resolution; avoid showing real
> card numbers or full PANs.

## 9. Final publishing entitlement submission package

- [ ] **App built against the publishing entitlement** (dev distribution
      restriction removed on the App ID), signed with the App Store
      distribution profile, uploaded to **App Store Connect / TestFlight**.
- [ ] **Demonstration video(s)** on a physical device: New User Flow (§5),
      Existing User Flow (§6), and a complete Checkout Flow (§7) showing the
      system sheet and a successful card-present charge.
- [ ] **Screenshots** from §8.
- [ ] **Processor confirmation**: Stripe Terminal Tap to Pay on iPhone is
      live on the account; Terminal capability enabled; a real live-mode
      charge + refund completed.
- [ ] **Entitlement / capability**: confirm the App ID has Tap to Pay on
      iPhone and the submitted build's `codesign` entitlements include the
      proximity-reader key.
- [ ] **App Review notes** in App Store Connect: test stylist credentials, a
      Stripe-connected demo account, and a step-by-step to reach
      Settings → Payments → Tap to Pay and take a charge (paste the §7 script).
- [ ] **Compliance**: usage strings present (`NSLocationWhenInUseUsageDescription`),
      no card data stored in-app, receipts offered to the customer.
- [ ] **Checklist v1.6 audit** (`docs/tap_to_pay_setup.md` §5) re-reviewed
      and each item satisfied in the submitted build.
- [ ] Submit the **publishing entitlement request** to Apple referencing
      Case-ID **20421391**, attaching the video(s) + screenshots, and request
      removal of the development distribution restriction.

---

### Quick reference — in-app paths
- Enable / status / education: **Settings → Payments → Tap to Pay**
- Take a payment: open an appointment with a balance → **In-person payment → Tap to Pay $XX**
- See the charge: **Money → Payments & Transactions** (and Stripe Dashboard)
