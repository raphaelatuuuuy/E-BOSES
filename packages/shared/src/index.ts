/**
 * Shared constants, enums, and types for E-Boses.
 *
 * This package provides shared interfaces between the frontend
 * and backend (future use with TypeScript-compatible tooling).
 */

// ============================================================
// User Roles
// ============================================================

export type UserRole = "resident" | "barangay_official" | "responder" | "admin";

export const USER_ROLES: Record<UserRole, string> = {
  resident: "Resident",
  barangay_official: "Barangay Official",
  responder: "Responder",
  admin: "Administrator",
} as const;

// ============================================================
// Verification Statuses
// ============================================================

export type VerificationStatus =
  | "pending_otp"
  | "pending_id_review"
  | "verified"
  | "rejected"
  | "suspended";

// ============================================================
// Concern Categories
// ============================================================

export type ConcernCategory =
  | "infrastructure"
  | "flooding"
  | "waste_management"
  | "stray_animals"
  | "street_lighting"
  | "vandalism"
  | "public_health"
  | "other";

export const CONCERN_CATEGORIES: Record<ConcernCategory, string> = {
  infrastructure: "Infrastructure",
  flooding: "Flooding",
  waste_management: "Waste Management",
  stray_animals: "Stray Animals",
  street_lighting: "Street Lighting",
  vandalism: "Vandalism",
  public_health: "Public Health",
  other: "Other",
} as const;

// ============================================================
// Concern Statuses
// ============================================================

export type ConcernStatus =
  | "submitted"
  | "under_review"
  | "in_progress"
  | "resolved"
  | "dismissed";

// ============================================================
// Emergency Alert Types
// ============================================================

export type EmergencyType = "medical" | "fire" | "disaster" | "crime" | "other";

export const EMERGENCY_TYPES: Record<EmergencyType, string> = {
  medical: "Medical",
  fire: "Fire",
  disaster: "Disaster",
  crime: "Crime",
  other: "Other",
} as const;
