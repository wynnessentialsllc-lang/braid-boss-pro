// Centralized admin allow-list. Single source of truth — referenced
// from every admin guard (page-level, API-level, RPC-level).
//
// Keep this list as short as possible. Anything that grants admin
// power MUST go through isAdminUser; never inline an email comparison.

const ADMIN_EMAILS = new Set<string>([
  "shereewynn@icloud.com",
]);

export const isAdminUser = (email?: string | null): boolean => {
  if (!email || typeof email !== "string") return false;
  return ADMIN_EMAILS.has(email.toLowerCase().trim());
};
