import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import { apiRequest } from "@/lib/api"

/**
 * The barangay's concern categories, from the database.
 *
 * Every surface used to hardcode "Infrastructure / Environment / Public Safety /
 * Others" — the report form, the Overview breakdown, the concern detail header.
 * Those four existed nowhere in the database, so the Categories screen could not
 * rename, route or add to them: an official adding "Illegal dumping" would see
 * it in Configuration and nowhere else.
 *
 * Loaded once and shared, because several panels on the same screen need the
 * same list and none of them should each fetch it.
 */

export interface ConcernCategoryOption {
  id: number
  code: string
  name: string
  description: string
  icon_key?: string
  custom_icon_label?: string
  icon_image_url?: string
  department: { id: number; name: string; short_name: string } | null
}

interface CategoriesState {
  categories: ConcernCategoryOption[]
  loading: boolean
  /** Display name for a stored category code. */
  labelFor: (code: string | null | undefined) => string
}

/** Only used until the fetch resolves, and for codes deleted since a concern was
 *  filed — never as the list a resident picks from. */
const LEGACY_LABELS: Record<string, string> = {
  infrastructure: "Infrastructure",
  environment: "Environment",
  public_safety: "Public Safety",
  others: "Others",
}

function humanise(code: string) {
  const spaced = code.replace(/[_-]+/g, " ").trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const ConcernCategoriesContext = createContext<CategoriesState | null>(null)

export function ConcernCategoriesProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<ConcernCategoryOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void apiRequest<ConcernCategoryOption[]>("/concerns/categories/")
      .then((next) => {
        if (!cancelled) setCategories(next)
      })
      .catch(() => {
        // A failed fetch must not block filing a concern; callers fall back to
        // whatever code the record already carries.
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const value = useMemo<CategoriesState>(() => {
    const byCode = new Map(categories.map((category) => [category.code, category]))
    return {
      categories,
      loading,
      labelFor: (code) => {
        if (!code) return "Uncategorised"
        return byCode.get(code)?.name ?? LEGACY_LABELS[code] ?? humanise(code)
      },
    }
  }, [categories, loading])

  return (
    <ConcernCategoriesContext.Provider value={value}>{children}</ConcernCategoriesContext.Provider>
  )
}

export function useConcernCategories(): CategoriesState {
  const context = useContext(ConcernCategoriesContext)
  if (context) return context
  // Usable outside the provider (standalone dialogs, tests) so a missing
  // provider degrades to legacy labels rather than crashing the screen.
  return {
    categories: [],
    loading: false,
    labelFor: (code) =>
      !code ? "Uncategorised" : (LEGACY_LABELS[code] ?? humanise(code)),
  }
}

/** Standalone loader for surfaces outside the provider, e.g. the report dialog. */
export function useCategoryOptions() {
  const [categories, setCategories] = useState<ConcernCategoryOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void apiRequest<ConcernCategoryOption[]>("/concerns/categories/")
      .then((next) => {
        if (!cancelled) setCategories(next)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { categories, loading }
}
