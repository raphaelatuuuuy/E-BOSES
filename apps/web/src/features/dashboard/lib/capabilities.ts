/**
 * Capability vocabulary, mirrored from apps/capabilities.py.
 *
 * This drives which navigation entries appear and which actions are enabled.
 * It is presentation only: every gated endpoint enforces the same capability
 * server-side, so a tampered client gains nothing but a screen that 403s.
 */

export const CAPABILITIES = {
  manageUnits: "manage_units",
  manageRoles: "manage_roles",
  manageUsers: "manage_users",
  reviewVerification: "review_verification",
  handlePrivacy: "handle_privacy",
  resolveConcerns: "resolve_concerns",
  manageCategories: "manage_categories",
  configureClassification: "configure_classification",
  configureDispatch: "configure_dispatch",
  configureGeography: "configure_geography",
  publishAnnouncements: "publish_announcements",
  dispatchEmergencies: "dispatch_emergencies",
} as const

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES]

/** Plain-language names, used in "Requires …" messages on disabled controls. */
export const CAPABILITY_LABEL: Record<string, string> = {
  manage_units: "Manage units",
  manage_roles: "Manage roles",
  manage_users: "Manage users",
  review_verification: "Review verification",
  handle_privacy: "Handle privacy requests",
  resolve_concerns: "Resolve concerns",
  manage_categories: "Manage categories",
  configure_classification: "Configure AI classification",
  configure_dispatch: "Configure dispatch",
  configure_geography: "Configure geography",
  publish_announcements: "Publish announcements",
  dispatch_emergencies: "Dispatch emergencies",
}

export function hasCapability(
  capabilities: readonly string[] | undefined,
  required: string | undefined,
): boolean {
  if (!required) return true
  return Boolean(capabilities?.includes(required))
}

/** Reason text for a disabled control. Disabled-with-reason teaches the
 *  permission model; hiding the control just looks broken. */
export function capabilityReason(required: string): string {
  return `Requires “${CAPABILITY_LABEL[required] ?? required}”`
}
