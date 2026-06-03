// Global feature flags.
//
// SMS_ENABLED gates every SMS / text-message (Twilio) surface across the
// app. Texting isn't live yet (no approved provider), so all SMS-facing
// UI — the SMS credits screen, per-client / per-booking text-reminder
// opt-ins, the public booking-page SMS consent checkbox, and SMS-channel
// reminder templates — is hidden behind this flag. The underlying code
// and data paths are left intact so flipping this to `true` re-enables
// the whole feature once a provider is approved.
export const SMS_ENABLED = false;
