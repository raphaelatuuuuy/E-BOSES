import * as React from "react"
import { flushSync } from "react-dom"
import {
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
import {
  StepContinueButton,
  StepTitle,
} from "@/features/auth/components/sign-up-shell"
import {
  filterMarikinaHeightsStreets,
  matchMarikinaHeightsStreet,
} from "@/features/auth/lib/marikina-heights-streets"
import {
  getCurrentPosition,
  reverseGeocodeToMarikinaStreet,
} from "@/features/auth/lib/reverse-geocode"
import type { SignUpErrors, SignUpValues } from "@/features/auth/schemas/sign-up-schema"

function showLocationToast(message: string) {
  toast.error(message, {
    // Renders on the dedicated centered Toaster in main.tsx
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

const STREET_SUBTEXT = "Marikina Heights, Marikina City"

interface AddressStepProps {
  values: SignUpValues
  errors: SignUpErrors
  onChange: <K extends keyof SignUpValues>(field: K, value: SignUpValues[K]) => void
  onContinue: () => void
}

/** Paper plane slanted upper-right (matches Nextdoor location control). */
function LocationPlaneIcon({ className, strokeWidth = 1.75 }: { className?: string; strokeWidth?: number }) {
  return <SendIcon className={className} strokeWidth={strokeWidth} />
}

export function AddressStep({ values, errors, onChange, onContinue }: AddressStepProps) {
  const [query, setQuery] = React.useState(values.street || "")
  const [openList, setOpenList] = React.useState(false)
  // Auto-open when entering the step; also reopened from icon / dropdown.
  const [locationOpen, setLocationOpen] = React.useState(() => !values.street?.trim())
  const [locating, setLocating] = React.useState(false)
  const listRef = React.useRef<HTMLDivElement>(null)

  const hasQuery = query.trim().length > 0
  const streets = React.useMemo(
    () => (hasQuery ? filterMarikinaHeightsStreets(query, 50) : []),
    [query, hasQuery],
  )

  // Keep the local query in sync when the submit street changes externally
  // (parent reset) — render-adjust instead of a sync setState effect.
  const [prevStreet, setPrevStreet] = React.useState(values.street || "")
  if (prevStreet !== (values.street || "")) {
    setPrevStreet(values.street || "")
    setQuery(values.street || "")
  }

  React.useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!listRef.current?.contains(event.target as Node)) {
        setOpenList(false)
      }
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  function selectStreet(street: string) {
    onChange("street", street)
    setQuery(street)
    setOpenList(false)
  }

  function focusStreetInput() {
    setOpenList(true)
    requestAnimationFrame(() => {
      document.getElementById("street")?.focus()
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
        // Success: fill the street silently (no "Matched to …" feedback).
        onChange("street", result.street)
        setQuery(result.street)
        if (result.houseNumber) {
          onChange("houseNumber", result.houseNumber)
        }
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

  return (
    <div className="flex flex-1 flex-col pt-2">
      <StepTitle>Great! Let&apos;s find your neighborhood now.</StepTitle>

      <div className="mt-8 space-y-3" ref={listRef}>
        <Field>
          <div className="relative">
            <FloatingLabelInput
              id="street"
              type="text"
              label="Street address"
              value={query}
              className="pr-12"
              onChange={(e) => {
                setQuery(e.target.value)
                setOpenList(true)
                if (values.street) onChange("street", "")
              }}
              onFocus={() => setOpenList(true)}
              aria-invalid={Boolean(errors.street)}
              autoComplete="off"
              role="combobox"
              aria-expanded={openList}
              aria-controls="street-listbox"
            />

            {/* Paper-plane — reopens location permission dialog */}
            <button
              type="button"
              disabled={locating}
              onClick={openLocationDialog}
              className="absolute top-1/2 right-3 z-[2] -translate-y-1/2 rounded-full p-1.5 text-neutral-700 transition-[transform,colors] duration-150 ease-out hover:bg-neutral-100 active:scale-90 disabled:opacity-50 disabled:active:scale-100"
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
                id="street-listbox"
                role="listbox"
                className="absolute z-20 mt-1.5 max-h-72 w-full overflow-auto rounded-2xl border border-neutral-200/80 bg-white py-1 shadow-[0_8px_30px_rgba(15,23,42,0.12)]"
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
                      icon={<PencilIcon className="size-5" strokeWidth={1.75} />}
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
                      icon={<PencilIcon className="size-5" strokeWidth={1.75} />}
                      label="Enter your address manually"
                      onClick={() => focusStreetInput()}
                    />
                  </>
                ) : (
                  <>
                    {streets.map((street) => (
                      <button
                        key={street}
                        type="button"
                        role="option"
                        aria-selected={values.street === street}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3 text-left transition-[transform,colors] duration-150 ease-out hover:bg-neutral-50 active:scale-[0.98] active:bg-neutral-100",
                          values.street === street && "bg-neutral-50",
                        )}
                        onClick={() => selectStreet(street)}
                      >
                        <MapPinIcon
                          className="mt-0.5 size-5 shrink-0 text-neutral-700"
                          strokeWidth={1.75}
                        />
                        <span className="min-w-0">
                          <span className="block text-[15px] font-semibold leading-snug text-neutral-900">
                            {street}
                          </span>
                          <span className="mt-0.5 block text-sm leading-snug text-neutral-500">
                            {STREET_SUBTEXT}
                          </span>
                        </span>
                      </button>
                    ))}
                    <DropdownAction
                      icon={<PencilIcon className="size-5" strokeWidth={1.75} />}
                      label="Enter your address manually"
                      onClick={() => focusStreetInput()}
                    />
                  </>
                )}
              </div>
            ) : null}
          </div>
          {errors.street ? <FieldError>{errors.street}</FieldError> : null}
        </Field>

        {/* Privacy subtext under the input — matches Nextdoor shield copy */}
        <p className="flex items-start gap-2 text-sm leading-snug text-neutral-500">
          <ShieldCheckIcon
            className="mt-0.5 size-4 shrink-0 text-neutral-400"
            strokeWidth={2}
          />
          <span>Your address is only used to connect you to the right neighborhood.</span>
        </p>

        {/* Optional house/unit — shown after a street is chosen so the primary UI stays clean */}
        {values.street ? (
          <Field className="pt-1">
            <FloatingLabelInput
              id="houseNumber"
              type="text"
              label="House / unit number (optional)"
              value={values.houseNumber ?? ""}
              onChange={(e) => onChange("houseNumber", e.target.value)}
              aria-invalid={Boolean(errors.houseNumber)}
            />
            {errors.houseNumber ? <FieldError>{errors.houseNumber}</FieldError> : null}
          </Field>
        ) : null}
      </div>

      <StepContinueButton
        onClick={() => {
          // Accept a typed street if it fuzzy-matches the curated list.
          if (!values.street?.trim() && query.trim()) {
            const matched = matchMarikinaHeightsStreet(query)
            if (matched) {
              flushSync(() => {
                onChange("street", matched)
                setQuery(matched)
              })
            }
          }
          onContinue()
        }}
      >
        Continue
      </StepContinueButton>

      {/* Location permission: bottom sheet on mobile, centered modal on desktop */}
      <Dialog open={locationOpen} onOpenChange={setLocationOpen}>
        <DialogContent
          overlayClassName="bg-black/55"
          className={cn(
            "border-0 bg-white p-0 shadow-2xl",
            // Mobile: bottom sheet
            "left-0 right-0 top-auto bottom-0 max-h-[85vh] w-full max-w-none translate-x-0 translate-y-0 rounded-t-2xl rounded-b-none",
            // Desktop/laptop: centered modal
            "sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[min(100%-2rem,24rem)] sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
          )}
        >
          <div className="mx-auto w-full px-6 pb-8 pt-3 sm:px-7 sm:pb-6 sm:pt-8">
            {/* Drag handle — mobile only */}
            <div
              className="mx-auto mb-5 h-1 w-10 rounded-full bg-neutral-300 sm:hidden"
              aria-hidden
            />

            <h2 className="text-xl font-semibold leading-snug tracking-tight text-neutral-900 sm:text-[1.35rem]">
              Use your current location for your address?
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-neutral-600">
              E-Boses uses your location to place you in the right neighborhood, and if you&apos;re
              at home, to verify your account. You will need to enable your location permissions.
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