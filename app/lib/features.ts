// Global feature flags.
//
// SMS_ENABLED gates every SMS / text-message (Twilio) surface across the
// app: the SMS credits screen, per-client / per-booking text-reminder
// opt-ins, the public booking-page SMS consent checkbox, and SMS-channel
// reminder templates. Enabled now that the toll-free number is verified
// and live on the Twilio Messaging Service.
//
// Note: this is the platform-wide switch. Each stylist additionally has
// a per-account master switch (profiles.sms_notifications_enabled,
// default OFF) toggled in Account → Notifications, and the queue gate in
// queue_notification() enforces it server-side. So enabling this flag
// surfaces the UI but no texts send until a stylist opts in, a client
// opts in on the booking form, and the stylist holds SMS credits.
export const SMS_ENABLED = true;
