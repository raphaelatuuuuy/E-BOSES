import { useCallback, useEffect, useMemo, useState } from "react"

import type { AuthUser } from "@/features/auth/api"
import { listBarangayUnits } from "@/features/dashboard/api"

const UNIT_CHANGE_EVENT = "eboses:official-unit-change"

type OfficialUnit = {
  id: number
  code: string
  name: string
  short_name: string
  position?: string
  position_code?: string
}

function storageKey(userId: number | undefined) {
  return `eboses:selected-official-unit:${userId ?? "anonymous"}`
}

function readStoredUnit(userId: number | undefined) {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(storageKey(userId))
    const value = raw ? Number(raw) : NaN
    return Number.isInteger(value) ? value : null
  } catch {
    return null
  }
}

function writeStoredUnit(userId: number | undefined, unitId: number | null) {
  if (typeof window === "undefined") return
  try {
    if (unitId == null) window.sessionStorage.removeItem(storageKey(userId))
    else window.sessionStorage.setItem(storageKey(userId), String(unitId))
  } catch {
    // Session storage is a convenience; the overview still works when it is unavailable.
  }
}

export function useOfficialUnitScope(user: AuthUser | null) {
  const userUnits = user?.units
  const isSuperuser = user?.is_superuser === true
  const userId = user?.id
  const [superuserUnits, setSuperuserUnits] = useState<OfficialUnit[]>([])
  useEffect(() => {
    if (!isSuperuser) return
    let cancelled = false
    void listBarangayUnits()
      .then((items) => {
        if (!cancelled) {
          setSuperuserUnits(
            items
              .filter((item) => item.is_active)
              .map(({ id, code, name, short_name }) => ({
                id,
                code,
                name,
                short_name,
              })),
          )
        }
      })
      .catch(() => {
        if (!cancelled) setSuperuserUnits([])
      })
    return () => {
      cancelled = true
    }
  }, [isSuperuser])

  const units = useMemo<OfficialUnit[]>(
    () => (isSuperuser ? superuserUnits : userUnits ?? []),
    [isSuperuser, superuserUnits, userUnits],
  )
  const firstUnitId = isSuperuser ? null : units[0]?.id ?? null
  const [storedUnitId, setStoredUnitId] = useState<number | null>(() => {
    const stored = readStoredUnit(userId)
    if (isSuperuser) return stored
    return stored != null && units.some((unit) => unit.id === stored)
      ? stored
      : firstUnitId
  })

  const selectedUnitId = isSuperuser
    ? units.some((unit) => unit.id === storedUnitId)
      ? storedUnitId
      : null
    : units.some((unit) => unit.id === storedUnitId)
      ? storedUnitId
      : firstUnitId

  useEffect(() => {
    function onUnitChange(event: Event) {
      const unitId = (event as CustomEvent<{ unitId?: number | null }>).detail
        ?.unitId
      if (unitId == null) {
        if (isSuperuser) setStoredUnitId(null)
      } else if (units.some((unit) => unit.id === unitId)) {
        setStoredUnitId(unitId)
      }
    }
    window.addEventListener(UNIT_CHANGE_EVENT, onUnitChange as EventListener)
    return () =>
      window.removeEventListener(UNIT_CHANGE_EVENT, onUnitChange as EventListener)
  }, [firstUnitId, isSuperuser, units])

  const selectUnit = useCallback(
    (unitId: number | null) => {
      if (unitId == null) {
        if (!isSuperuser) return
      } else if (!units.some((unit) => unit.id === unitId)) return
      setStoredUnitId(unitId)
      writeStoredUnit(userId, unitId)
      window.dispatchEvent(
        new CustomEvent(UNIT_CHANGE_EVENT, { detail: { unitId } }),
      )
    },
    [isSuperuser, units, userId],
  )

  const selectedUnit = useMemo<OfficialUnit | null>(
    () => units.find((unit) => unit.id === selectedUnitId) ?? null,
    [selectedUnitId, units],
  )

  return { units, selectedUnit, selectedUnitId, selectUnit }
}
