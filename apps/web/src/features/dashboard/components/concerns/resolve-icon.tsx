import * as LucideIcons from "lucide-react"
import type { LucideIcon } from "lucide-react"

/** Kebab-case icon keys stored in the database → Lucide components. */
const KEY_MAP: Record<string, LucideIcon> = {
  tag: LucideIcons.TagsIcon,
  wrench: LucideIcons.WrenchIcon,
  leaf: LucideIcons.LeafIcon,
  "shield-alert": LucideIcons.ShieldAlertIcon,
  trash: LucideIcons.Trash2Icon,
  lightbulb: LucideIcons.LightbulbIcon,
  road: LucideIcons.ArrowRightIcon,
  droplets: LucideIcons.DropletsIcon,
  home: LucideIcons.HomeIcon,
  "map-pin": LucideIcons.MapPinIcon,
  "paw-print": LucideIcons.PawPrintIcon,
  megaphone: LucideIcons.MegaphoneIcon,
  pencil: LucideIcons.PencilIcon,
}

/** Check if an export is a Lucide icon component (function OR React component object). */
function isIconComponent(val: unknown): val is LucideIcon {
  if (!val) return false
  if (typeof val === "function") return true
  // React components wrapped as objects (lucide-react does this)
  if (typeof val === "object" && "$$typeof" in (val as Record<string, unknown>)) return true
  return false
}

/**
 * Resolve input text to the canonical Lucide icon key name.
 * Returns the actual export name (e.g. "TrafficConeIcon") or null.
 */
export function resolveIconName(input: string): string | null {
  if (!input) return null
  const trimmed = input.trim()
  // Direct match
  if (KEY_MAP[trimmed]) return trimmed
  const exact = (LucideIcons as Record<string, unknown>)[trimmed]
  if (isIconComponent(exact)) return trimmed
  // With Icon suffix
  const withSuffix = trimmed.endsWith("Icon") ? trimmed : `${trimmed}Icon`
  if (isIconComponent((LucideIcons as Record<string, unknown>)[withSuffix])) return withSuffix
  // PascalCase from lowercase
  const pascal = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  const pascalWithSuffix = pascal.endsWith("Icon") ? pascal : `${pascal}Icon`
  if (isIconComponent((LucideIcons as Record<string, unknown>)[pascalWithSuffix])) return pascalWithSuffix
  if (isIconComponent((LucideIcons as Record<string, unknown>)[pascal])) return pascal
  // Substring search
  const lower = trimmed.toLowerCase()
  for (const [key, val] of Object.entries(LucideIcons)) {
    if (isIconComponent(val) && /^[A-Z]/.test(key) && key.endsWith("Icon")) {
      if (key.toLowerCase().includes(lower)) return key
    }
  }
  return null
}

/**
 * Resolve a category icon_key to a Lucide component.
 * Handles kebab-case, PascalCase, and fuzzy lowercase inputs.
 */
export function resolveIconByKey(key: string | undefined | null): LucideIcon | null {
  if (!key) return null
  // Try kebab-case lookup first
  const kebab = KEY_MAP[key]
  if (kebab) return kebab
  // Try exact Lucide name
  const exact = (LucideIcons as Record<string, unknown>)[key]
  if (isIconComponent(exact)) return exact as LucideIcon
  // Fuzzy match via resolveIconName
  const resolved = resolveIconName(key)
  if (resolved) {
    const icon = (LucideIcons as Record<string, unknown>)[resolved]
    if (isIconComponent(icon)) return icon as LucideIcon
  }
  return null
}

/** Check if a string can resolve to a valid Lucide icon. */
export function isValidLucideName(name: string): boolean {
  if (!name) return false
  if (KEY_MAP[name]) return true
  return resolveIconName(name) !== null
}
