import { useCallback, useState } from "react"
import { LoaderCircleIcon, ShieldCheckIcon } from "lucide-react"

import { FieldError } from "@workspace/ui/components/field"

import {
  StepTitle,
} from "@/features/auth/components/sign-up-shell"
import LocationPickerModal, {
  type PinState,
} from "@/features/dashboard/components/location-picker"
import type { CommunityResolveResult } from "@/features/auth/api"
import type { SignUpErrors, SignUpValues } from "@/features/auth/schemas/sign-up-schema"

interface AddressStepProps {
  values: SignUpValues
  errors: SignUpErrors
  resolving: boolean
  onChange: <K extends keyof SignUpValues>(field: K, value: SignUpValues[K]) => void
  onResolve: (input: {
    latitude: number
    longitude: number
    accuracy?: number | null
    source: "gps" | "search" | "manual"
    address?: string
  }) => Promise<CommunityResolveResult>
  onContinue: () => void
}

export function AddressStep({
  values,
  errors,
  resolving,
  onChange,
  onResolve,
  onContinue,
}: AddressStepProps) {
  const [pin, setPin] = useState<PinState | null>(null)
  const [error, setError] = useState("")
  const [confirming, setConfirming] = useState(false)

  const handlePinState = useCallback((state: PinState | null) => {
    setPin(state)
    setError("")
  }, [])

  async function confirmAndContinue() {
    if (!pin?.ready) return
    setError("")
    setConfirming(true)
    // Order matters: changing the street clears any previous pin, so the
    // coordinates are written after it.
    onChange("street", pin.addressPrimary)
    onChange("address", pin.address)
    onChange("homeLatitude", pin.lat)
    onChange("homeLongitude", pin.lng)
    onChange("homeAccuracyMeters", null)
    onChange("homeLocationSource", "manual")
    try {
      // The pin is also the community confirmation — there is no separate
      // screen for it, so this has to succeed before the wizard moves on.
      await onResolve({ latitude: pin.lat, longitude: pin.lng, source: "manual", address: pin.address })
      onContinue()
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "No community covers this location yet.",
      )
    } finally {
      setConfirming(false)
    }
  }

  const busy = resolving || confirming

  return (
    <div className="-mt-4 flex flex-1 flex-col md:-mt-6">
      <StepTitle className="text-center">Great! Let&apos;s find your neighborhood now.</StepTitle>

      <div className="relative mt-4 h-[24rem] overflow-hidden rounded-2xl sm:h-[28rem]">
        <LocationPickerModal
          open
          signup
          renderInline
          recenterOnOpen
          strictBoundary
          onClose={() => {}}
          onConfirm={() => void confirmAndContinue()}
          onPinStateChange={handlePinState}
          initialLat={values.homeLatitude}
          initialLng={values.homeLongitude}
          initialAddress={values.address}
        />
        {busy ? (
          <div className="absolute inset-0 z-[1500] grid place-items-center bg-white/70">
            <LoaderCircleIcon className="size-6 animate-spin text-primary" />
          </div>
        ) : null}
      </div>

      <p className="mt-3 flex items-start gap-2 text-sm leading-snug text-neutral-500">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-neutral-400" strokeWidth={2} />
        <span>Your address is only used to connect you to the right neighborhood.</span>
      </p>

      {error || errors.street ? (
        <FieldError className="mt-2">{error || errors.street}</FieldError>
      ) : null}
    </div>
  )
}
