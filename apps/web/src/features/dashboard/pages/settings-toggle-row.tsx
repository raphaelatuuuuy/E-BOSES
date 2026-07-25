import { Checkbox } from "@workspace/ui/components/checkbox"

export function SettingsToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  busy,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  busy?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-neutral-200 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-[15px] font-medium text-neutral-900">
          {label}
        </label>
        <p className="mt-1 text-[13px] leading-5 text-neutral-500">{description}</p>
      </div>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled || busy}
        aria-busy={busy}
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-0.5"
      />
    </div>
  )
}