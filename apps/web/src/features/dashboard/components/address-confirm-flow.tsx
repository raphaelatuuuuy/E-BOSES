import * as React from "react"
import {
  LoaderCircleIcon,
  MapPinIcon,
  PencilIcon,
  SendIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"

import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { NeighborhoodPeekCards } from "@/features/auth/components/sign-up-steps/verified-peek-step"
import { parseStoredAddress } from "@/features/dashboard/lib/address-parse"
import { getCurrentPosition } from "@/features/auth/lib/reverse-geocode"
import {
  lookupRegistrationPinAddress,
  searchRegistrationStreets,
  updateMe,
} from "@/features/auth/api"
import { Field, FieldError } from "@workspace/ui/components/field"
import {
  SheetDialog,
  SheetPrimaryButton,
  SheetSecondaryButton,
} from "@/features/dashboard/components/sheet-dialog"

type FlowStep = "confirm" | "edit" | "peek"

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
  open: boolean
  onClose: () => void
  onSaved: (address: string) => void
  communityName?: string
}

export function AddressConfirmFlow({
  initialAddress,
  open,
  onClose,
  onSaved,
  communityName = "Your community",
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
  const [streetOptions, setStreetOptions] = React.useState<string[]>([])

  React.useEffect(() => {
    const needle = query.trim()
    if (!needle) {
      return
    }
    let cancelled = false
    void searchRegistrationStreets(needle, 50)
      .then((result) => {
        if (cancelled) return
        setStreetOptions(
          (result.results ?? [])
            .filter((item) => !communityName || item.community === communityName)
            .map((item) => item.name)
            .filter((name, index, values) => values.indexOf(name) === index),
        )
      })
      .catch(() => {
        if (!cancelled) setStreetOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [communityName, query])

  const streets = hasQuery ? streetOptions : []

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

  async function applyCurrentLocation() {
    setLocationOpen(false)
    setLocating(true)
    setOpenList(false)
    try {
      const position = await getCurrentPosition()
      const result = await lookupRegistrationPinAddress(
        position.coords.latitude,
        position.coords.longitude,
      )

      if (!result.inside_community || !result.street) {
        showLocationToast(
          `Your location is outside ${communityName}. Please choose a street inside the community.`,
        )
        return
      }
      if (communityName && result.community !== communityName) {
        showLocationToast(
          `Your location is in ${result.community}, not ${communityName}. Please choose a street inside your community.`,
        )
        return
      }
      setStreet(result.street)
      setQuery(result.street)
      setStreetError(null)
      if (result.house_number) setHouseNumber(result.house_number)
    } catch (error: unknown) {
      showLocationToast(locationErrorMessage(error))
    } finally {
      setLocating(false)
    }
  }

  function handleBack() {
    if (step === "edit") {
      setQuery(street)
      setOpenList(false)
      setStep(street ? "confirm" : "edit")
    } else {
      onClose()
    }
  }

  async function handleConfirm() {
    const matched = street.trim()
    if (!matched) {
      setStreetError("Please choose a street from the list.")
      return
    }
    setSaving(true)
    try {
      const value = `${houseNumber?.trim() ? `${houseNumber.trim()} ` : ""}${matched}, ${communityName}`
      await updateMe({ address: value })
      onSaved(value)
      onClose()
    } catch {
      toast.error("Could not save address. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  function handleEditContinue() {
    const matched = street.trim()
    if (!matched) {
      setStreetError("Please choose a street from the list.")
      return
    }
    setStreetError(null)
    setStep("peek")
  }

  const headerTitle =
    step === "confirm"
      ? "Confirm address"
      : step === "edit"
        ? "Enter your new address"
        : "Neighborhood"

  if (!open) return null

  return (
    <SheetDialog
      open={open}
      onClose={onClose}
      onBack={step === "edit" ? handleBack : undefined}
      title={headerTitle}
      size="wide"
      footer={
        <div className="flex gap-2">
          <SheetSecondaryButton onClick={onClose} className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]">
            Cancel
          </SheetSecondaryButton>
          {step === "confirm" ? (
            <SheetPrimaryButton
              tone="accent"
              type="button"
              disabled={saving || !street.trim()}
              onClick={() => void handleConfirm()}
              className="flex-1 text-[15px]"
            >
              {saving ? "Saving…" : "Confirm"}
            </SheetPrimaryButton>
          ) : step === "edit" ? (
            <SheetPrimaryButton
              tone="accent"
              type="button"
              onClick={handleEditContinue}
              className="flex-1 text-[15px]"
            >
              Continue
            </SheetPrimaryButton>
          ) : (
            <SheetPrimaryButton
              tone="accent"
              type="button"
              onClick={onClose}
              className="flex-1 text-[15px]"
            >
              Done
            </SheetPrimaryButton>
          )}
        </div>
      }
    >
      <div className="space-y-4 px-1">
        {/* ── Confirm ── */}
        {step === "confirm" ? (
          <>
            <p className="text-[14px] leading-relaxed text-neutral-500">
              Your address is in {communityName}. You can update it when you
              move within the barangay.
            </p>

            <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-neutral-200 bg-white px-4 py-3.5">
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
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-white px-5 text-[14px] font-medium text-neutral-700 transition-colors hover:border-primary hover:bg-primary hover:text-white"
              >
                Edit
              </button>
            </div>
          </>
        ) : null}

        {/* ── Edit ── */}
        {step === "edit" ? (
          <>
            <p className="text-[14px] leading-relaxed text-neutral-500">
              Choose a street in {communityName} only.
            </p>

            <div className="space-y-3" ref={listRef}>
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
                      className="absolute z-20 mt-1.5 max-h-72 w-full overflow-auto scrollbar-hide rounded-[14px] border-[1.5px] border-neutral-200 bg-white py-1 shadow-lg"
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
                          <p className="px-4 py-3 text-[14px] text-neutral-500">
                             No matching streets in {communityName}.
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
                                <span className="block text-[15px] font-medium leading-snug text-neutral-900">
                                  {item}
                                </span>
                                <span className="mt-0.5 block text-[13px] leading-snug text-neutral-500">
                                  {communityName}
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

              <p className="flex items-start gap-2 text-[13px] leading-snug text-neutral-500">
                <ShieldCheckIcon
                  className="mt-0.5 size-4 shrink-0 text-neutral-400"
                  strokeWidth={2}
                />
                <span>
                  Your address is only used to connect you to {communityName}.
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

            {/* Nested location dialog */}
            <LocationDialog
              open={locationOpen}
              onOpenChange={setLocationOpen}
              onUseLocation={() => void applyCurrentLocation()}
              onTypeAddress={() => {
                setLocationOpen(false)
                focusStreetInput()
              }}
            />
          </>
        ) : null}

        {/* ── Verified peek ── */}
        {step === "peek" ? (
          <>
            <p className="text-[14px] leading-relaxed text-neutral-500">
              Here&apos;s a peek at {communityName}.
            </p>
            <NeighborhoodPeekCards street={street} houseNumber={houseNumber} />
          </>
        ) : null}
      </div>
    </SheetDialog>
  )
}

function LocationDialog({
  open,
  onOpenChange,
  onUseLocation,
  onTypeAddress,
  communityName = "your community",
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onUseLocation: () => void
  onTypeAddress: () => void
  communityName?: string
}) {
  return (
    <SheetDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Use current location?"
      size="compact"
      footer={
        <div className="flex gap-2">
          <SheetSecondaryButton onClick={onTypeAddress} className="mt-0 h-[52px] w-[25%] flex-shrink-0 text-[15px]">
            Type instead
          </SheetSecondaryButton>
          <SheetPrimaryButton
            tone="accent"
            type="button"
            onClick={onUseLocation}
            className="flex-1 text-[15px]"
          >
            Use current location
          </SheetPrimaryButton>
        </div>
      }
    >
      <p className="text-[14px] leading-relaxed text-neutral-500">
        E-Boses uses your location to place you in {communityName},
        and if you&apos;re at home, to verify your account. You will
        need to enable your location permissions.
      </p>
    </SheetDialog>
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
      className="flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] font-medium text-neutral-900 transition-[transform,colors] duration-150 ease-out hover:bg-neutral-50 active:scale-[0.98] active:bg-neutral-100 disabled:opacity-60 disabled:active:scale-100"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-neutral-700">
        {icon}
      </span>
      {label}
    </button>
  )
}
