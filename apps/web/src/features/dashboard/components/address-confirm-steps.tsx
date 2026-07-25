import * as React from "react"
import { MapPin as MapPinIcon, PaperPlaneRight, Pencil, ShieldCheck as ShieldCheckIcon, Spinner } from "@phosphor-icons/react"

import {
  Dialog,
  DialogContent,
} from "@workspace/ui/components/dialog"
import { Field, FieldError } from "@workspace/ui/components/field"
import { cn } from "@workspace/ui/lib/utils"

import { FloatingLabelInput } from "@/features/auth/components/floating-label-input"
import { NeighborhoodPeekCards } from "@/features/auth/components/sign-up-steps/verified-peek-step"

const STREET_SUBTEXT = "Marikina Heights, Marikina City"

function LocationPlaneIcon({
  className,
  strokeWidth = 1.75,
}: {
  className?: string
  strokeWidth?: number
}) {
  return <PaperPlaneRight className={className} strokeWidth={strokeWidth} />
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

export function ConfirmStep({
  streetOnly,
  saving,
  street,
  onEdit,
  onConfirm,
}: {
  streetOnly: string
  saving: boolean
  street: string
  onEdit: () => void
  onConfirm: () => void
}) {
  return (
    <div className="flex flex-col pt-4">
      <h2 className="text-[1.65rem] font-bold leading-tight tracking-tight text-[#020c4e]">
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
          onClick={onEdit}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-white px-5 text-[14px] font-semibold text-neutral-700 transition-colors hover:border-[#ff8133] hover:bg-[#ff8133] hover:text-white"
        >
          Edit
        </button>
      </div>

      <button
        type="button"
        disabled={saving || !street.trim()}
        onClick={onConfirm}
        className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-[#ff8133] text-[15px] font-semibold text-white transition-colors hover:bg-[#e6732e] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 disabled:hover:bg-neutral-200 disabled:opacity-100"
      >
        {saving ? (
          <>
            <Spinner className="mr-2 size-4 animate-spin" />
            Saving…
          </>
        ) : (
          "Confirm"
        )}
      </button>
    </div>
  )
}

export function EditStep({
  street,
  houseNumber,
  query,
  openList,
  locationOpen,
  locating,
  streetError,
  listRef,
  streets,
  hasQuery,
  onQueryChange,
  onSelectStreet,
  onFocusStreet,
  onOpenLocation,
  onUseCurrentLocation,
  onEditContinue,
  onLocationOpenChange,
  onHouseNumberChange,
}: {
  street: string
  houseNumber: string
  query: string
  openList: boolean
  locationOpen: boolean
  locating: boolean
  streetError: string | null
  saving: boolean
  listRef: React.RefObject<HTMLDivElement | null>
  streets: string[]
  hasQuery: boolean
  onQueryChange: (value: string) => void
  onSelectStreet: (street: string) => void
  onFocusStreet: () => void
  onOpenLocation: () => void
  onUseCurrentLocation: () => void
  onEditContinue: () => void
  onLocationOpenChange: (open: boolean) => void
  onHouseNumberChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col pt-4">
      <h2 className="text-[1.65rem] font-bold leading-tight tracking-tight text-[#020c4e]">
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
              onChange={(e) => onQueryChange(e.target.value)}
              onFocus={onFocusStreet}
              aria-invalid={Boolean(streetError)}
              autoComplete="off"
              role="combobox"
              aria-expanded={openList}
              aria-controls="settings-street-listbox"
            />

            <button
              type="button"
              disabled={locating}
              onClick={onOpenLocation}
              className="absolute top-1/2 right-3 z-[2] -translate-y-1/2 rounded-full p-1.5 text-neutral-700 transition-[transform,colors] duration-150 ease-out hover:bg-neutral-100 active:scale-90 disabled:opacity-50"
              aria-label="Use current location"
            >
              {locating ? (
                <Spinner className="size-5 animate-spin text-primary" />
              ) : (
                <LocationPlaneIcon className="size-5" />
              )}
            </button>

            {openList ? (
              <div
                id="settings-street-listbox"
                role="listbox"
                className="absolute z-20 mt-1.5 max-h-72 w-full overflow-auto rounded-2xl border border-neutral-200/80 bg-white py-1 shadow-[0_8px_30px_rgba(15,23,42,0.12)]"
              >
                {!hasQuery ? (
                  <>
                    <DropdownAction
                      icon={
                        locating ? (
                          <Spinner className="size-5 animate-spin" />
                        ) : (
                          <LocationPlaneIcon className="size-5" />
                        )
                      }
                      label="At home? Use your current location"
                      disabled={locating}
                      onClick={onOpenLocation}
                    />
                    <DropdownAction
                      icon={<Pencil className="size-5" />}
                      label="Enter your address manually"
                      onClick={onFocusStreet}
                    />
                  </>
                ) : streets.length === 0 ? (
                  <>
                    <p className="px-4 py-3 text-sm text-muted-foreground">
                      No matching streets in Marikina Heights.
                    </p>
                    <DropdownAction
                      icon={<Pencil className="size-5" />}
                      label="Enter your address manually"
                      onClick={onFocusStreet}
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
                        onClick={() => onSelectStreet(item)}
                      >
                        <MapPinIcon
                          className="mt-0.5 size-5 shrink-0 text-neutral-700"
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
                      icon={<Pencil className="size-5" />}
                      label="Enter your address manually"
                      onClick={onFocusStreet}
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
            weight="bold"
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
              onChange={(e) => onHouseNumberChange(e.target.value)}
            />
          </Field>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onEditContinue}
        className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-[#ff8133] text-[15px] font-semibold text-white transition-colors hover:bg-[#e6732e]"
      >
        Continue
      </button>

      <Dialog open={locationOpen} onOpenChange={onLocationOpenChange}>
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
                onClick={onUseCurrentLocation}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#ff8133] px-6 text-[15px] font-semibold text-white shadow-sm transition-[transform,colors,filter,box-shadow] duration-150 ease-out hover:bg-[#e6732e] active:scale-[0.96] active:brightness-95 active:shadow-none"
              >
                Use current location
                <LocationPlaneIcon className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  onLocationOpenChange(false)
                  onFocusStreet()
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

export function PeekStep({
  street,
  houseNumber,
  onClose,
}: {
  street: string
  houseNumber: string
  onClose: () => void
}) {
  return (
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
        className="mt-8 flex h-12 w-full items-center justify-center rounded-full bg-[#ff8133] text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-[#e6732e]"
      >
        Continue
      </button>
    </div>
  )
}
