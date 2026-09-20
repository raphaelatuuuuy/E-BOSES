import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import {
  BadgeCheckIcon,
  CalendarClockIcon,
  CircleCheck,
  ChevronDownIcon,
  ClockIcon,
  PlusIcon,
  ShieldCheckIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@workspace/ui/lib/utils"
import {
  createManagedAnnouncement,
  updateManagedAnnouncement,
  type Announcement,
  type AnnouncementAreaContext,
} from "@/features/dashboard/api"
import { AreaPicker } from "./area-picker"
import { ADVISORY_TAGS } from "./advisory-tags"
import { areaFromAnnouncement, emptyArea, type AreaPickerValue } from "./area-lib"

export interface AnnouncementDraft {
  title: string
  body: string
  tag: string
  audience: Announcement["audience"]
  urgency: Announcement["urgency"]
  is_pinned: boolean
  is_published: boolean
  starts_at: string
  expires_at: string
  image_alt: string
}

const emptyAnnouncement: AnnouncementDraft = {
  title: "",
  body: "",
  tag: "General advisory",
  audience: "all",
  urgency: "normal",
  is_pinned: false,
  is_published: true,
  starts_at: "",
  expires_at: "",
  image_alt: "",
}

const AUDIENCE_OPTIONS = [
  { value: "all", label: "All users", icon: UsersIcon },
  { value: "residents", label: "Residents only", icon: UserIcon },
  { value: "responders", label: "Responders only", icon: ShieldCheckIcon },
  { value: "officials", label: "Officials only", icon: BadgeCheckIcon },
] as const

function localDateTime(value: string | null | undefined) {
  if (!value) return ""
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function announcementDraftFrom(initial: Announcement): AnnouncementDraft {
  return {
    title: initial.title,
    body: initial.body,
    tag: initial.tag,
    audience: initial.audience,
    urgency: initial.urgency,
    is_pinned: initial.is_pinned,
    is_published: true,
    starts_at: localDateTime(initial.starts_at),
    expires_at: localDateTime(initial.expires_at),
    image_alt: initial.image_alt || "",
  }
}

const inputClass =
  "mt-1.5 w-full rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[16px] text-neutral-900 outline-none transition-colors focus:border-neutral-500"

const labelClass = "text-[13px] font-semibold text-neutral-500"

const SCHEDULE_PRESETS = [
  { key: "now", label: "Now", icon: ClockIcon },
  { key: "1h", label: "In 1 hour", icon: ClockIcon },
  { key: "tomorrow", label: "Tomorrow", icon: CalendarClockIcon },
  { key: "weekend", label: "This weekend", icon: CalendarClockIcon },
  { key: "custom", label: "Custom", icon: null },
] as const

type SchedulePreset = (typeof SCHEDULE_PRESETS)[number]["key"]

function applyPreset(preset: SchedulePreset): { starts: string; expires: string } {
  const now = new Date()
  switch (preset) {
    case "now":
      return { starts: "", expires: "" }
    case "1h": {
      const h = new Date(now.getTime() + 60 * 60_000)
      return { starts: localDateTime(h.toISOString()), expires: "" }
    }
    case "tomorrow": {
      const d = new Date(now)
      d.setDate(d.getDate() + 1)
      d.setHours(9, 0, 0, 0)
      return { starts: localDateTime(d.toISOString()), expires: "" }
    }
    case "weekend": {
      const d = new Date(now)
      const day = d.getDay()
      const sat = day === 6 ? 0 : 6 - day
      d.setDate(d.getDate() + sat)
      d.setHours(8, 0, 0, 0)
      const end = new Date(d)
      end.setDate(end.getDate() + 1)
      end.setHours(17, 0, 0, 0)
      return {
        starts: localDateTime(d.toISOString()),
        expires: localDateTime(end.toISOString()),
      }
    }
    case "custom":
      return { starts: "", expires: "" }
  }
}

/** Simple calendar date+time picker. */
function CalendarPicker({
  label,
  value,
  onChange,
  align = "left",
}: {
  label: string
  value: string
  onChange: (v: string) => void
  align?: "left" | "right"
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const date = value ? new Date(value) : null
  const [viewDate, setViewDate] = useState(() => date ?? new Date())
  const [hour, setHour] = useState(date ? date.getHours() % 12 : 0)
  const [minute, setMinute] = useState(date ? date.getMinutes() : 0)
  const [ampm, setAmpm] = useState(date ? (date.getHours() >= 12 ? "PM" : "AM") : "AM")

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  function applyDate(d: Date) {
    const h24 = ampm === "PM" ? (hour % 12) + 12 : hour % 12
    d.setHours(h24, minute, 0, 0)
    const offset = d.getTimezoneOffset() * 60_000
    onChange(new Date(d.getTime() - offset).toISOString().slice(0, 16))
  }

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = new Date()
  const monthLabel = viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })

  const displayText = date
    ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      " " +
      date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "Select date"

  return (
    <div className="relative" ref={ref}>
      <label className="grid gap-1 text-[13px] font-normal text-neutral-500">
        <span>{label}</span>
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o)
            if (date) {
              setViewDate(date)
              setHour(date.getHours() % 12)
              setMinute(date.getMinutes())
              setAmpm(date.getHours() >= 12 ? "PM" : "AM")
            }
          }}
          className={cn(
            "mt-1.5 flex w-full items-center gap-2 rounded-[14px] border-[1.5px] bg-white px-4 py-3 text-[16px] outline-none transition-colors",
            open ? "border-neutral-500" : "border-neutral-300 hover:border-neutral-400",
            date ? "text-neutral-900" : "text-neutral-400",
          )}
        >
          <CalendarClockIcon className="size-4 shrink-0 text-neutral-400" />
          {displayText}
        </button>
      </label>
      {open ? (
        <div className={cn("absolute top-full z-[1300] mt-1 w-[min(300px,calc(100vw-3rem))] overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white p-3 shadow-lg", align === "right" ? "right-0" : "left-0")}>
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setViewDate(new Date(year, month - 1))}
              className="flex size-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              ‹
            </button>
            <span className="text-[13px] font-semibold text-neutral-900">{monthLabel}</span>
            <button
              type="button"
              onClick={() => setViewDate(new Date(year, month + 1))}
              className="flex size-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              ›
            </button>
          </div>
          <div className="mb-1 grid grid-cols-7 gap-0.5">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
              <span key={d} className="py-1 text-center text-[11px] font-medium text-neutral-400">
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: firstDay }).map((_, i) => (
              <span key={`e${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1
              const isSelected =
                date &&
                date.getFullYear() === year &&
                date.getMonth() === month &&
                date.getDate() === day
              const isToday =
                today.getFullYear() === year && today.getMonth() === month && today.getDate() === day
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    const d = new Date(year, month, day)
                    setViewDate(d)
                    applyDate(d)
                  }}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-[13px] transition-colors",
                    isSelected
                      ? "bg-brand-navy font-semibold text-white"
                      : isToday
                        ? "bg-neutral-100 font-medium text-neutral-900"
                        : "text-neutral-700 hover:bg-neutral-50",
                  )}
                >
                  {day}
                </button>
              )
            })}
          </div>
          <div className="mt-3 border-t border-neutral-100 pt-3">
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={12}
                value={String(hour).padStart(2, "0")}
                onChange={(e) => {
                  const v = Math.min(12, Math.max(0, Number(e.target.value) || 0))
                  setHour(v)
                }}
                className="h-9 w-12 rounded-[10px] border-[1.5px] border-neutral-200 bg-white px-2 text-center text-[13px] text-neutral-900 outline-none transition-colors focus:border-neutral-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="text-[13px] text-neutral-300">:</span>
              <input
                type="number"
                min={0}
                max={59}
                step={15}
                value={String(minute).padStart(2, "0")}
                onChange={(e) => {
                  const v = Math.min(59, Math.max(0, Number(e.target.value) || 0))
                  setMinute(v)
                }}
                className="h-9 w-12 rounded-[10px] border-[1.5px] border-neutral-200 bg-white px-2 text-center text-[13px] text-neutral-900 outline-none transition-colors focus:border-neutral-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => setAmpm((v) => (v === "AM" ? "PM" : "AM"))}
                className="h-9 rounded-[10px] border-[1.5px] border-neutral-200 bg-white px-3 text-[13px] font-medium text-neutral-900 outline-none transition-colors hover:bg-neutral-50"
              >
                {ampm}
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              {value ? (
                <button
                  type="button"
                  onClick={() => {
                    onChange("")
                    setOpen(false)
                  }}
                  className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-neutral-500 hover:bg-neutral-100"
                >
                  Clear
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  const now = new Date()
                  setViewDate(now)
                  setHour(now.getHours() % 12)
                  setMinute(now.getMinutes())
                  setAmpm(now.getHours() >= 12 ? "PM" : "AM")
                  const offset = now.getTimezoneOffset() * 60_000
                  onChange(new Date(now.getTime() - offset).toISOString().slice(0, 16))
                }}
                className="rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-neutral-500 hover:bg-neutral-100"
              >
                Now
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function ContentComposer({
  initial,
  areaContext,
  isPinned,
  onSaved,
  onFormStateChange,
}: {
  initial?: Announcement | null
  areaContext: AnnouncementAreaContext | null
  isPinned: boolean
  onSaved: () => void
  onFormStateChange?: (state: { canSave: boolean; busy: boolean; editing: boolean }) => void
}) {
  const [announcement, setAnnouncement] = useState<AnnouncementDraft>(() => initial ? announcementDraftFrom(initial) : emptyAnnouncement)
  const [announcementImage, setAnnouncementImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(() => initial?.image_url ?? null)
  const [area, setArea] = useState<AreaPickerValue>(() => initial ? areaFromAnnouncement(initial.affected_streets, initial.area_geometry) : emptyArea)
  const [editingAnnouncement] = useState<number | null>(() => initial?.id ?? null)
  const [busy, setBusy] = useState("")
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>(() => initial && (initial.starts_at || initial.expires_at) ? "custom" : "now")
  const [tagMenuOpen, setTagMenuOpen] = useState(false)
  const [audienceOpen, setAudienceOpen] = useState(false)
  const tagMenuRef = useRef<HTMLDivElement>(null)
  const audienceRef = useRef<HTMLDivElement>(null)

  const editing = editingAnnouncement != null

  const initialDraft = useMemo(() => initial ? announcementDraftFrom(initial) : null, [initial])
  const initialArea = useMemo(() => initial ? areaFromAnnouncement(initial.affected_streets, initial.area_geometry) : emptyArea, [initial])

  const dirty = useMemo(() => {
    if (!editing) return true
    return (
      announcementImage != null ||
      isPinned !== (initial?.is_pinned ?? false) ||
      JSON.stringify(announcement) !== JSON.stringify(initialDraft) ||
      JSON.stringify(area) !== JSON.stringify(initialArea)
    )
  }, [announcement, area, announcementImage, editing, initial, initialArea, initialDraft, isPinned])

  const hasContent = announcement.title.trim() !== "" && announcement.body.trim() !== ""
  const canSave = editing ? dirty : hasContent

  useEffect(() => {
    onFormStateChange?.({ canSave, busy: busy === "save", editing })
  }, [canSave, busy, editing, onFormStateChange])

  useEffect(() => {
    if (!tagMenuOpen && !audienceOpen) return
    function onPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node)) return
      if (tagMenuRef.current?.contains(event.target)) return
      if (audienceRef.current?.contains(event.target)) return
      setTagMenuOpen(false)
      setAudienceOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [tagMenuOpen, audienceOpen])

  useEffect(() => {
    return () => {
      if (imagePreview && imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview)
    }
  }, [imagePreview])

  function pickImage(file: File | null) {
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview)
    setAnnouncementImage(file)
    setImagePreview(file ? URL.createObjectURL(file) : (initial?.image_url ?? null))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy("save")
    try {
      const payload = {
        ...announcement,
        is_published: true,
        is_pinned: isPinned,
        starts_at: announcement.starts_at ? new Date(announcement.starts_at).toISOString() : null,
        expires_at: announcement.expires_at ? new Date(announcement.expires_at).toISOString() : null,
        affected_streets: area.streets,
        area_geometry: area.geometry,
      }
      let requestBody: Partial<Announcement> | FormData = payload
      if (announcementImage) {
        const form = new FormData()
        Object.entries(payload).forEach(([key, value]) => {
          if (value === undefined) return
          if (key === "affected_streets" || key === "area_geometry") {
            form.append(key, JSON.stringify(value))
            return
          }
          if (value === null && (key === "starts_at" || key === "expires_at")) {
            form.append(key, "")
            return
          }
          if (value !== null) form.append(key, String(value))
        })
        form.append("image", announcementImage)
        requestBody = form
      }
      if (editing) await updateManagedAnnouncement(editingAnnouncement, requestBody)
      else await createManagedAnnouncement(requestBody)
      toast.success(editing ? "Announcement updated" : "Announcement published")
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.")
    } finally {
      setBusy("")
    }
  }

  const audienceLabel =
    AUDIENCE_OPTIONS.find((option) => option.value === announcement.audience)?.label ?? "All users"

  return (
    <form id="announcement-form" className="space-y-6 pb-4" onSubmit={save}>
      <label className="block">
        <span className={labelClass}>Title</span>
        <input
          required
          maxLength={160}
          value={announcement.title}
          onChange={(e) => setAnnouncement((v) => ({ ...v, title: e.target.value }))}
          placeholder="Announcement title"
          className={inputClass}
        />
      </label>

      {/* Type + Audience side by side on wider sheets, stacked on phones */}
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
        <div className="relative" ref={tagMenuRef}>
          <label className="block">
            <span className={labelClass}>Type</span>
            <button
              type="button"
              onClick={() => setTagMenuOpen((o) => !o)}
              className={cn(inputClass, "flex w-full items-center gap-2 text-left")}
            >
              <span className="min-w-0 flex-1 truncate">{announcement.tag}</span>
              <ChevronDownIcon className={cn("size-4 shrink-0 transition-transform", tagMenuOpen && "rotate-180")} />
            </button>
          </label>
          {tagMenuOpen ? (
            <div className="absolute left-0 right-0 top-full z-[1200] mt-1 overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white py-1 shadow-lg">
              {ADVISORY_TAGS.map((tag) => {
                const Icon = tag.icon
                return (
                  <button
                    key={tag.value}
                    type="button"
                    onClick={() => {
                      setAnnouncement((v) => ({ ...v, tag: tag.value }))
                      setTagMenuOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[15px] text-neutral-900 transition-colors hover:bg-neutral-50"
                  >
                    <Icon className="size-4 shrink-0" strokeWidth={2} style={{ color: tag.color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{tag.label}</span>
                    {announcement.tag === tag.value ? (
                      <CircleCheck className="size-4 shrink-0 text-green-600" strokeWidth={2} />
                    ) : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>

        <div className="relative" ref={audienceRef}>
          <label className="block">
            <span className={labelClass}>Audience</span>
            <button
              type="button"
              onClick={() => setAudienceOpen((o) => !o)}
              className={cn(inputClass, "flex w-full items-center gap-2 text-left")}
            >
              <span className="min-w-0 flex-1 truncate">{audienceLabel}</span>
              <ChevronDownIcon className={cn("size-4 shrink-0 transition-transform", audienceOpen && "rotate-180")} />
            </button>
          </label>
          {audienceOpen ? (
            <div className="absolute left-0 right-0 top-full z-[1200] mt-1 overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white py-1 shadow-lg">
              {AUDIENCE_OPTIONS.map((option) => {
                const AIcon = option.icon
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setAnnouncement((v) => ({ ...v, audience: option.value }))
                      setAudienceOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[15px] text-neutral-900 transition-colors hover:bg-neutral-50"
                  >
                    <AIcon className="size-4 shrink-0 text-brand-navy" strokeWidth={2} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {announcement.audience === option.value ? (
                      <CircleCheck className="size-4 shrink-0 text-green-600" strokeWidth={2} />
                    ) : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>

      <label className="block">
        <span className={labelClass}>Message</span>
        <textarea
          required
          maxLength={3000}
          ref={(el) => {
            if (el) {
              el.style.height = "auto"
              el.style.height = `${el.scrollHeight}px`
            }
          }}
          value={announcement.body}
          onChange={(e) => {
            setAnnouncement((v) => ({ ...v, body: e.target.value }))
            const el = e.target
            el.style.height = "auto"
            el.style.height = `${el.scrollHeight}px`
          }}
          placeholder="Information residents need to know"
          className={`${inputClass} resize-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden`}
        />
      </label>

      <div>
        <span className={labelClass}>Schedule</span>
        <div className="mt-1.5 flex flex-wrap gap-2">
            {SCHEDULE_PRESETS.map(({ key, label, icon: Icon }) => {
              const active = schedulePreset === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setSchedulePreset(key)
                    if (key === "custom") return
                    const { starts, expires } = applyPreset(key)
                    setAnnouncement((v) => ({ ...v, starts_at: starts, expires_at: expires }))
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-normal transition-colors",
                    active
                      ? "bg-brand-navy text-white"
                      : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200",
                  )}
                >
                  {Icon ? <Icon className="size-3.5" /> : null}
                  {label}
                </button>
              )
            })}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4">
            <CalendarPicker
              label="Starts"
              value={announcement.starts_at}
              onChange={(v) => setAnnouncement((a) => ({ ...a, starts_at: v }))}
            />
            <CalendarPicker
              label="Expires"
              value={announcement.expires_at}
              onChange={(v) => setAnnouncement((a) => ({ ...a, expires_at: v }))}
              align="right"
            />
          </div>
        </div>

      <div>
        {imagePreview ? (
          <div className="relative overflow-hidden rounded-[14px] bg-neutral-100">
            <img src={imagePreview} alt="Banner preview" className="h-40 w-full object-cover" />
            <button
              type="button"
              onClick={() => pickImage(null)}
              aria-label="Remove banner image"
              className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        ) : (
          <label className="flex h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-[14px] bg-neutral-100 text-neutral-400 transition-colors hover:bg-neutral-200">
            <PlusIcon className="size-6" />
            <span className="text-[13px]">Add an image</span>
            <input type="file" accept="image/*" onChange={(e) => pickImage(e.target.files?.[0] ?? null)} className="hidden" />
          </label>
        )}
      </div>

      {/* Affected area */}
      <div>
        <span className={labelClass}>Affected area</span>
        <div className="mt-1.5">
          <AreaPicker
            context={areaContext}
            value={area}
            onChange={setArea}
            tag={announcement.tag}
            excludeId={editingAnnouncement}
          />
        </div>
      </div>
    </form>
  )
}
