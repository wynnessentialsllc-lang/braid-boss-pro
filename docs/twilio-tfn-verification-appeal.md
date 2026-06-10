# Toll-free verification rejection — appeal / re-submission notes

Our toll-free verification for the production SMS number **+18556298377**
(attached to Messaging Service `MG72a42abd8c856af96835c99c49ba5fe7` — see
`docs/b12_2_sms_setup.md`) was **rejected**.

- **Reason:** `30526 – High Risk: Submission Flagged for High-Risk Domain Issues`
- **Rejection type:** cannot edit/re-submit the existing request; a **new**
  verification must be filed.
- **Does NOT mean the number is banned** — the normal path is to fix the
  underlying domain signal and file a fresh toll-free verification on the
  same number. Open a Twilio Support ticket first so they tell you the
  exact signal that tripped it.

## Rejected request IDs (for reference)

| Field | Value |
|---|---|
| Account SID | _(from the rejection email — `AC…`; omitted here, push protection flags it)_ |
| Toll-Free Verification Request SID | `HHd06f278d02cdc42714f7240041031e41` |
| Phone Number | `+18556298377` |
| Legal entity | Wynn Essentials, LLC |
| Brand / website | Braid Boss Pro — https://braidbosspro.app |

## Likely cause

Reason 30526 is about the **website/domain** on the verification form, not
the message content. In order of likelihood for our setup:

1. **Domain age / reputation** — `braidbosspro.app` being recently
   registered is the single most common 30526 trigger. Usually needs a
   support ticket + time, not a content change.
2. **Opt-in not reachable / not visible** when reviewed — the reviewer must
   be able to see the SMS-consent checkbox on the public booking form and
   the SMS section of the privacy policy.
3. **Opt-in description mismatch** between the form text and the live site.

## Do NOT

- **Do not release the number.** Keep `+18556298377`; it's already attached
  to the Messaging Service and re-verifying the same number is cleaner than
  re-provisioning.

## Support-ticket draft

Send via Twilio Console → Help → Get Support, or reply to the rejection
email at `trusthub-verify@twilio.com`.

> **Subject:** Toll-Free Verification rejected — Reason 30526 (High-Risk
> Domain) — request for flagged-signal detail & re-submission path
>
> Hello Twilio Trust & Safety team,
>
> Our toll-free verification was rejected and I'd like to understand the
> specific signal and the correct path to re-submit, since the rejection
> type blocks editing the existing request.
>
> **Account / request details**
> - Account SID: `AC…` _(fill in from the rejection email)_
> - Toll-Free Verification Request SID: `HHd06f278d02cdc42714f7240041031e41`
> - Phone Number: `+18556298377`
> - Business / legal entity: Wynn Essentials, LLC
> - Brand / website: Braid Boss Pro — https://braidbosspro.app
> - Rejection reason: **30526 – High Risk: Submission Flagged for
>   High-Risk Domain Issues**
>
> **Questions**
> 1. Which specific domain signal triggered the high-risk flag (domain
>    age/reputation, the opt-in not being reachable, a content category, or
>    something in the message samples)? Knowing the exact factor lets us
>    correct it rather than guess.
> 2. Since this rejection type can't be re-submitted, what's the correct
>    path to file a new verification for the same number — a brand-new
>    toll-free verification on `+18556298377`, or do you recommend a
>    different remediation first?
>
> **Use case / compliance context (unchanged, low-risk transactional)**
> - Braid Boss Pro is a booking/CRM tool for independent hair braiders. SMS
>   is strictly **transactional**: appointment confirmations, reminders,
>   balance-due notices, and post-appointment rebooking nudges (~1–5
>   messages per appointment). No marketing or promotional sends.
> - **Opt-in** is explicit: clients check an SMS-consent box on the
>   stylist's public booking form before submitting; consent is logged with
>   a timestamp. The consent language and our SMS policy are published at
>   https://braidbosspro.app/privacy (see the "SMS messaging" section),
>   including the standard "mobile opt-in data is never shared with third
>   parties for marketing" clause.
> - **Opt-out**: every outbound message appends "Reply STOP to opt out."
>   STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT unsubscribe immediately; HELP
>   returns help text. Carrier-compliant advanced opt-out is enabled on the
>   number.
>
> We're happy to provide opt-in screenshots, the live booking-form URL, or
> any additional documentation that would help clear the flag. Thank you
> for the detail on the specific signal so we can submit a clean request.
>
> Best regards,
> Wynn Essentials, LLC
> wynnessentialsllc@gmail.com
