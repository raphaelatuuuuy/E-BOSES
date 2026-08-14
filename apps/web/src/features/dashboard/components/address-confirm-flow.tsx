import * as React from "react"
import { flushSync } from "react-dom"
import {
  ChevronLeftIcon,
  Loader2Icon,
  LoaderCircleIcon,
  MapPinIcon,
  PencilIcon,
  SendIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
} from "@workspace/ui/components/dialog"
import { Field, FieldError } from "@workspace/ui/components/field"
import { cn } from "@workspace/ui/lib/utils"

import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { NeighborhoodPeekCards } from "@/features/auth/components/sign-up-steps/verified-peek-step"
import { parseStoredAddress } from "@/features/dashboard/lib/address-parse"
import {
  filterMarikinaHeightsStreets,
  formatStreetAddress,
  isKnownMarikinaHeightsStreet,
  matchMarikinaHeightsStreet,
} from "@/features/auth/lib/marikina-heights-streets"
import {
  getCurrentPosition,
  reverseGeocodeToMarikinaStreet,
} from "@/features/auth/lib/reverse-geocode"
import { updateMe } from "@/features/auth/api"

type FlowStep = "confirm" | "edit" | "peek"

const STREET_SUBTEXT = "Marikina Heights, Marikina City"

function LocationPlaneIcon({
  className,
  strokeWidth = 1.75,
}: {
  className?: string
  strokeWidth?: number
}) {
  return <SendIcon className={className} strokeWidth={strokeWidth} />
}

function showLocationToast(message: string) {
  toast.error(message, {
    toasterId: "center",
    duration: 4500,
  })
}

function locationErrorMessage(error: unknown) {
  if (error instanceof GeolocationPositionError) {
    if (error.code === error.PERMISSION_DENIED) {
      return "Location access was not allowed. Enable location for this site in your browser settings, or select your street from the list."
    }
    if (error.code === error.TIMEOUT) {
      return "Location request timed out. Please try again or select your street from the list."
    }
    if (error.code === error.POSITION_UNAVAILABLE) {
      return "Your location is unavailable right now. Please select your street from the list."
    }
  }
  return "Could not get your location. Please select your street from the list."
}

/** Confirm card: street (+ optional house #) only — no city suffix. */
function displayStreetOnly(street: string, houseNumber: string) {
  if (!street.trim()) return ""
  const house = houseNumber?.trim()
  return house ? `${house} ${street.trim()}` : street.trim()
}

interface AddressConfirmFlowProps {
  initialAddress: string
  onClose: () => void
  onSaved: (address: string) => void
}

export function AddressConfirmFlow({
  initialAddress,
  onClose,
  onSaved,
}: AddressConfirmFlowProps) {
  const parsed = React.useMemo(
    () => parseStoredAddress(initialAddress),
    [initialAddress],
  )

  const [step, setStep] = React.useState<FlowStep>(() =>
    parsed.street ? "confirm" : "edit",
  )
  const [street, setStreet] = React.useState(parsed.street)
  const [houseNumber, setHouseNumber] = React.useState(parsed.houseNumber)
  const [query, setQuery] = React.useState(parsed.street)
  const [openList, setOpenList] = React.useState(false)
  const [locationOpen, setLocationOpen] = React.useState(
    () => !parsed.street?.trim(),
  )
  const [locating, setLocating] = React.useState(false)
  const [streetError, setStreetError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const listRef = React.useRef<HTMLDivElement>(null)

  const hasQuery = query.trim().length > 0
  const streets = React.useMemo(
    () => (hasQuery ? filterMarikinaHeightsStreets(query, 50) : []),
    [query, hasQuery],
  )

  const streetOnly = displayStreetOnly(street, houseNumber)

  React.useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!listRef.current?.contains(event.target as Node)) {
        setOpenList(false)
      }
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  function selectStreet(next: string) {
    setStreet(next)
    setQuery(next)
    setOpenList(false)
    setStreetError(null)
  }

  function focusStreetInput() {
    setOpenList(true)
    requestAnimationFrame(() => {
      document.getElementById("settings-street")?.focus()
    })
  }

  function openLocationDialog() {
    setOpenList(false)
    setLocationOpen(true)
  }

  // Not a hook: an async click handler. The `use` prefix made the linter
  // treat it as one (rules-of-hooks fired on the JSX call site) and made
  // readers do a double-take at `useCurrentLocation()` inside onClick.
  async function applyCurrentLocation() {
    setLocationOpen(false)
    setLocating(true)
    setOpenList(false)
    try {
      const position = await getCurrentPosition()
      const result = await reverseGeocodeToMarikinaStreet(
        position.coords.latitude,
        position.coords.longitude,
      )
      if (result.ok && result.street) {
        setStreet(result.street)
        setQuery(result.street)
        if (result.houseNumber) {
          setHouseNumber(result.houseNumber)
        }
        setStreetError(null)
      } else {
        showLocationToast(
          result.message ||
            "Could not get your location. Please select your street from the list.",
        )
        setOpenList(true)
      }
    } catch (error) {
      showLocationToast(locationErrorMessage(error))
      setOpenList(true)
    } finally {
      setLocating(false)
    }
  }

  function resolveStreetFromQuery(): string | null {
    if (street.trim() && isKnownMarikinaHeightsStreet(street)) return street.trim()
    if (query.trim()) {
      const matched = matchMarikinaHeightsStreet(query)
      if (matched) return matched
    }
    return null
  }

  function handleEditContinue() {
    let resolved = resolveStreetFromQuery()
    if (!resolved && query.trim()) {
      const matched = matchMarikinaHeightsStreet(query)
      if (matched) {
        flushSync(() => {
          setStreet(matched)
          setQuery(matched)
        })
        resolved = matched
      }
    }
    if (!resolved || !isKnownMarikinaHeightsStreet(resolved)) {
      setStreetError("Select a street in Barangay Marikina Heights.")
      return
    }
    setStreet(resolved)
    setQuery(resolved)
    setStreetError(null)
    setStep("confirm")
  }

  async function handleConfirm() {
    const resolved = resolveStreetFromQuery()
    if (!resolved || !isKnownMarikinaHeightsStreet(resolved)) {
      setStep("edit")
      setStreetError("Select a street in Barangay Marikina Heights.")
      return
    }
    const nextAddress = formatStreetAddress(resolved, houseNumber)
    setSaving(true)
    try {
      await updateMe({ address: nextAddress })
      onSaved(nextAddress)
      setStreet(resolved)
      setStep("peek")
    } catch {
      toast.error("Could not save your address. Try again.")
    } finally {
      setSaving(false)
    }
  }

  function handleBack() {
    if (step === "peek") {
      onClose()
      return
    }
    if (step === "edit") {
      if (parsed.street || street) {
        setStep("confirm")
        setStreetError(null)
      } else {
        onClose()
      }
      return
    }
    onClose()
  }

  const headerTitle =
    step === "confirm"
      ? "Confirm your address"
      : step === "edit"
        ? "Enter your new address"
        : "Neighborhood"

  return (
    <div className="fixed inset-0 z-[500] flex flex-col bg-white">
      {/* Sign-up style: centered column only — no sidebar / shell chrome */}
      <div className="mx-auto flex h-full w-full max-w-[600px] flex-col px-5 pb-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.5rem))] pt-[max(0.5rem,env(safe-area-inset-top))] md:px-0 md:pt-6">
        <header className="relative mb-1 flex h-12 shrink-0 items-center justify-center">
          <button
            type="button"
            onClick={handleBack}
            className="absolute left-0 flex size-10 items-center justify-center rounded-full text-neutral-800 hover:bg-neutral-100"
            aria-label="Back"
          >
            <ChevronLeftIcon className="size-6" strokeWidth={2.25} />
          </button>
          {step !== "peek" ? (
            <h1 className="text-[17px] font-semibold tracking-tight text-neutral-900">
              {headerTitle}
            </h1>
          ) : null}
        </header>

        <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {/* ── Confirm ── */}
          {step === "confirm" ? (
            <div className="flex flex-col pt-4">
              <h2 className="text-[1.65rem] font-bold leading-tight tracking-tight text-foreground">
                Confirm your address
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-neutral-600">
                Your address is in Marikina Heights. You can update it when you
                move within the barangay.
              </p>

              <div className="mt-6 flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 shadow-sm">
                <p className="min-w-0 flex-1 whitespace-pre-line text-[15px] font-medium leading-snug text-neutral-900">
                  {streetOnly || (
                    <span className="font-normal text-neutral-400">
                      No address yet
                    </span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery(street)
                    setLocationOpen(false)
                    setStep("edit")
                  }}
                  className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-white px-5 text-[14px] font-semibold text-neutral-700 transition-colors hover:border-primary hover:bg-primary hover:text-white"
                >
                  Edit
                </button>
              </div>

              <button
                type="button"
                disabled={saving || !street.trim()}
                onClick={() => void handleConfirm()}
                className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white transition-colors hover:bg-brand-orange-strong disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:hover:bg-neutral-200 disabled:opacity-100"
              >
                {saving ? (
                  <>
                    <Loader2Icon className="mr-2 size-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Confirm"
                )}
              </button>
            </div>
          ) : null}

          {/* ── Edit ── */}
          {step === "edit" ? (
            <div className="flex flex-col pt-4">
              <h2 className="text-[1.65rem] font-bold leading-tight tracking-tight text-foreground">
                Enter your new address
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">
                Choose a street in Barangay Marikina Heights only.
              </p>

              <div className="mt-6 space-y-3" ref={listRef}>
                <Field>
                  <div className="relative">
                    <FloatingLabelInput
                      id="settings-street"
                      type="text"
                      label="Street address"
                      value={query}
                      className="pr-12"
                      onChange={(e) => {
                        setQuery(e.target.value)
                        setOpenList(true)
                        if (street) setStreet("")
                        setStreetError(null)
                      }}
                      onFocus={() => setOpenList(true)}
                      aria-invalid={Boolean(streetError)}
                      autoComplete="off"
                      role="combobox"
                      aria-expanded={openList}
                      aria-controls="settings-street-listbox"
                    />

                    <button
                      type="button"
                      disabled={locating}
                      onClick={openLocationDialog}
                      className="absolute top-1/2 right-3 z-[2] -translate-y-1/2 rounded-full p-1.5 text-neutral-700 transition-[transform,colors] duration-150 ease-out hover:bg-neutral-100 active:scale-90 disabled:opacity-50"
                      aria-label="Use current location"
                    >
                      {locating ? (
                        <LoaderCircleIcon className="size-5 animate-spin text-primary" />
                      ) : (
                        <LocationPlaneIcon className="size-5" />
                      )}
                    </button>

                    {openList ? (
                      <div
                        id="settings-street-listbox"
                        role="listbox"
                        className="absolute z-20 mt-1.5 max-h-72 w-full overflow-auto scrollbar-hide rounded-2xl border border-neutral-200/80 bg-white py-1 shadow-[0_8px_30px_rgba(15,23,42,0.12)]"
                      >
                        {!hasQuery ? (
                          <>
                            <DropdownAction
                              icon={
                                locating ? (
                                  <LoaderCircleIcon className="size-5 animate-spin" />
                                ) : (
                                  <LocationPlaneIcon className="size-5" />
                                )
                              }
                              label="At home? Use your current location"
                              disabled={locating}
                              onClick={openLocationDialog}
                            />
                            <DropdownAction
                              icon={
                                <PencilIcon className="size-5" strokeWidth={1.75} />
                              }
                              label="Enter your address manually"
                              onClick={() => focusStreetInput()}
                            />
                          </>
                        ) : streets.length === 0 ? (
                          <>
                            <p className="px-4 py-3 text-sm text-muted-foreground">
                              No matching streets in Marikina Heights.
                            </p>
                            <DropdownAction
                              icon={
                                <PencilIcon className="size-5" strokeWidth={1.75} />
                              }
                              label="Enter your address manually"
                              onClick={() => focusStreetInput()}
                            />
                          </>
                        ) : (
                          <>
                            {streets.map((item) => (
                              <button
                                key={item}
                                type="button"
                                role="option"
                                aria-selected={street === item}
                                className={cn(
                                  "flex w-full items-start gap-3 px-4 py-3 text-left transition-[transform,colors] duration-150 ease-out hover:bg-neutral-50 active:scale-[0.98] active:bg-neutral-100",
                                  street === item && "bg-neutral-50",
                                )}
                                onClick={() => selectStreet(item)}
                              >
                                <MapPinIcon
                                  className="mt-0.5 size-5 shrink-0 text-neutral-700"
                                  strokeWidth={1.75}
                                />
                                <span className="min-w-0">
                                  <span className="block text-[15px] font-semibold leading-snug text-neutral-900">
                                    {item}
                                  </span>
                                  <span className="mt-0.5 block text-sm leading-snug text-neutral-500">
                                    {STREET_SUBTEXT}
                                  </span>
                                </span>
                              </button>
                            ))}
                            <DropdownAction
                              icon={
                                <PencilIcon className="size-5" strokeWidth={1.75} />
                              }
                              label="Enter your address manually"
                              onClick={() => focusStreetInput()}
                            />
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                  {streetError ? <FieldError>{streetError}</FieldError> : null}
                </Field>

                <p className="flex items-start gap-2 text-sm leading-snug text-neutral-500">
                  <ShieldCheckIcon
                    className="mt-0.5 size-4 shrink-0 text-neutral-400"
                    strokeWidth={2}
                  />
                  <span>
                    Your address is only used to connect you to Marikina Heights.
                  </span>
                </p>

                {street ? (
                  <Field className="pt-1">
                    <FloatingLabelInput
                      id="settings-house"
                      type="text"
                      label="House / unit number (optional)"
                      value={houseNumber}
                      onChange={(e) => setHouseNumber(e.target.value)}
                    />
                  </Field>
                ) : null}
              </div>

              <button
                type="button"
                onClick={handleEditContinue}
                className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white transition-colors hover:bg-brand-orange-strong"
              >
                Continue
              </button>

              <Dialog open={locationOpen} onOpenChange={setLocationOpen}>
                <DialogContent
                  overlayClassName="bg-black/55"
                  className={cn(
                    "border-0 bg-white p-0 shadow-2xl",
                    "left-0 right-0 top-auto bottom-0 max-h-[85vh] w-full max-w-none translate-x-0 translate-y-0 rounded-t-2xl rounded-b-none",
                    "sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[min(100%-2rem,24rem)] sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
                  )}
                >
                  <div className="mx-auto w-full px-6 pb-8 pt-3 sm:px-7 sm:pb-6 sm:pt-8">
                    <div
                      className="mx-auto mb-5 h-1 w-10 rounded-full bg-neutral-300 sm:hidden"
                      aria-hidden
                    />
                    <h2 className="text-xl font-semibold leading-snug tracking-tight text-neutral-900 sm:text-[1.35rem]">
                      Use your current location for your address?
                    </h2>
                    <p className="mt-3 text-[15px] leading-relaxed text-neutral-600">
                      E-Boses uses your location to place you in Marikina Heights,
                      and if you&apos;re at home, to verify your account. You will
                      need to enable your location permissions.
                    </p>
                    <div className="mt-6 flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => void applyCurrentLocation()}
                        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-[15px] font-semibold text-white shadow-sm transition-[transform,colors,filter,box-shadow] duration-150 ease-out hover:bg-brand-orange-strong active:scale-[0.96] active:brightness-95 active:shadow-none"
                      >
                        Use current location
                        <LocationPlaneIcon className="size-4" strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLocationOpen(false)
                          focusStreetInput()
                        }}
                        className="h-12 w-full rounded-full text-[15px] font-semibold text-neutral-800 transition-[transform,colors] duration-150 ease-out hover:bg-neutral-100 active:scale-[0.96] active:bg-neutral-200/80"
                      >
                        Type address instead
                      </button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          ) : null}

          {/* ── Verified peek ── */}
          {step === "peek" ? (
            <div className="flex flex-col pt-2">
              <h2 className="text-[1.45rem] font-bold leading-tight tracking-tight text-neutral-900 sm:text-[1.6rem]">
                You&apos;re verified! Here&apos;s a peek at Marikina Heights.
              </h2>
              <div className="mt-6">
                <NeighborhoodPeekCards street={street} houseNumber={houseNumber} />
              </div>
              <button
                type="button"
                onClick={onClose}
                className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-primary text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange-strong"
              >
                Continue
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function DropdownAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-[15px] font-medium text-neutral-900 transition-[transform,colors] duration-150 ease-out hover:bg-neutral-50 active:scale-[0.98] active:bg-neutral-100 disabled:opacity-60 disabled:active:scale-100"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-neutral-700">
        {icon}
      </span>
      {label}
    </button>
  )
}