import { FloppyDisk, Spinner } from "@phosphor-icons/react"
import { FieldError } from "@/features/dashboard/components/profile-helpers"

function sanitizeName(value: string) {
  return value.replace(/[^A-Za-zÑñ ]/g, "")
}

export function ProfileEditForm({
  profileForm,
  profileErrors,
  savingProfile,
  onFieldChange,
  onSubmit,
}: {
  profileForm: { first_name: string; last_name: string; address: string }
  profileErrors: Partial<Record<string, string>>
  savingProfile: boolean
  onFieldChange: (field: string, value: string) => void
  onSubmit: () => void
}) {
  return (
    <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-neutral-700">First name</span>
          <input
            value={profileForm.first_name}
            onChange={(e) => onFieldChange("first_name", sanitizeName(e.target.value))}
            className="mt-1 h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-900 outline-none focus:border-neutral-400"
          />
          <FieldError message={profileErrors.first_name} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-neutral-700">Last name</span>
          <input
            value={profileForm.last_name}
            onChange={(e) => onFieldChange("last_name", sanitizeName(e.target.value))}
            className="mt-1 h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-900 outline-none focus:border-neutral-400"
          />
          <FieldError message={profileErrors.last_name} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-semibold text-neutral-700">Address</span>
          <textarea
            value={profileForm.address}
            onChange={(e) => onFieldChange("address", e.target.value)}
            className="mt-1 min-h-20 w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-900 outline-none focus:border-neutral-400"
          />
          <FieldError message={profileErrors.address} />
        </label>
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={savingProfile}
        className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-[#ff6a1a] px-4 text-sm font-semibold text-white hover:bg-[#e85f17] disabled:opacity-60"
      >
        {savingProfile ? <Spinner className="size-4 animate-spin" /> : <FloppyDisk className="size-4" />}
        Save changes
      </button>
    </div>
  )
}
