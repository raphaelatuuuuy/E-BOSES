import { type FormEvent, type Ref, useEffect, useImperativeHandle, useRef, useState } from "react"
import {
  CalendarDaysIcon,
  CheckIcon,
  ChevronDownIcon,
  ImageIcon,
  MapPinIcon,
  MegaphoneIcon,
  PlusIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  createManagedAnnouncement,
  updateManagedAnnouncement,
  type Announcement,
  type AnnouncementAreaContext,
} from "@/features/dashboard/api"
import LocationPickerModal from "@/features/dashboard/components/location-picker"
import { AreaPicker } from "./area-picker"
import { ADVISORY_TAGS, advisoryMeta } from "./advisory-tags"
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
  is_published: false,
  starts_at: "",
  expires_at: "",
  image_alt: "",
}

function localDateTime(value: string | null | undefined) {
  if (!value) return ""
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

const inputClass =
  "h-11 rounded-xl border border-line-tint px-3 text-sm font-semibold text-brand-navy outline-none focus:border-brand-orange"

const labelClass = "grid gap-1 text-xs font-semibold text-navy-muted"

export interface ContentComposerHandle {
  editAnnouncement: (item: Announcement) => void
}

export function ContentComposer({
  areaContext,
  onSaved,
  composerRef,
}: {
  areaContext: AnnouncementAreaContext | null
  onSaved: () => void
  composerRef?: Ref<ContentComposerHandle>
}) {
  const [announcement, setAnnouncement] = useState(emptyAnnouncement)
  const [announcementImage, setAnnouncementImage] = useState<File | null>(null)
  const [area, setArea] = useState<AreaPickerValue>(emptyArea)
  const [place, setPlace] = useState<{ lat: number; lng: number; label: string } | null>(null)
  const [placePickerOpen, setPlacePickerOpen] = useState(false)
  const [editingAnnouncement, setEditingAnnouncement] = useState<number | null>(null)
  const [busy, setBusy] = useState("")
  const [optionsOpen, setOptionsOpen] = useState(false)
  const tagMenuRef = useRef<HTMLDivElement>(null)
  const [tagMenuOpen, setTagMenuOpen] = useState(false)

  const editing = editingAnnouncement != null

  function reset() {
    setAnnouncement(emptyAnnouncement)
    setAnnouncementImage(null)
    setArea(emptyArea)
    setPlace(null)
    setEditingAnnouncement(null)
    setOptionsOpen(false)
  }

  function loadAnnouncement(item: Announcement) {
    setEditingAnnouncement(item.id)
    setAnnouncement({
      title: item.title,
      body: item.body,
      tag: item.tag,
      audience: item.audience,
      urgency: item.urgency,
      is_pinned: item.is_pinned,
      is_published: item.is_published,
      starts_at: localDateTime(item.starts_at),
      expires_at: localDateTime(item.expires_at),
      image_alt: item.image_alt || "",
    })
    setAnnouncementImage(null)
    setArea(areaFromAnnouncement(item.affected_streets, item.area_geometry))
    setPlace(
      item.latitude != null && item.longitude != null
        ? {
            lat: Number(item.latitude),
            lng: Number(item.longitude),
            label: item.place_label || "Pinned place",
          }
        : null,
    )
    setOptionsOpen(Boolean(item.starts_at || item.expires_at || item.is_pinned || item.image_alt))
  }

  useImperativeHandle(
    composerRef,
    () => ({ editAnnouncement: loadAnnouncement }),
    [],
  )

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy("save")
    try {
      const payload = {
        ...announcement,
        starts_at: announcement.starts_at ? new Date(announcement.starts_at).toISOString() : null,
        expires_at: announcement.expires_at ? new Date(announcement.expires_at).toISOString() : null,
        affected_streets: area.streets,
        area_geometry: area.geometry,
        latitude: place ? String(place.lat) : null,
        longitude: place ? String(place.lng) : null,
        place_label: place?.label ?? "",
      }
      let requestBody: Partial<Announcement> | FormData = payload
      if (announcementImage) {
        const form = new FormData()
        Object.entries(payload).forEach(([key, value]) => {
          if (value === undefined) return
          if (key === "affected_streets" || key === "area_geometry") {
            // JSON fields must be encoded as JSON text (DRF parses it back)
            // — String() would turn arrays into "a,b,c" and objects into
            // "[object Object]". JSON.stringify(null) === "null", so a
            // cleared area still reaches the server as a real null.
            form.append(key, JSON.stringify(value))
            return
          }
          if (
            value === null &&
            (key === "starts_at" ||
              key === "expires_at" ||
              key === "latitude" ||
              key === "longitude")
          ) {
            // Multipart mode must clear optional dates the same way JSON
            // mode does. An omitted field on PATCH means "keep the old
            // value", so skipping the null would silently leave a cleared
            // expiry in place. DRF's DateTimeField(allow_null=True) maps
            // "" to None.
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
      toast.success(editing ? "Announcement updated" : "Announcement created")
      reset()
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.")
    } finally {
      setBusy("")
    }
  }

  // Close the type menu when clicking anywhere outside it.
  useEffect(() => {
    if (!tagMenuOpen) return
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !tagMenuRef.current?.contains(event.target)) {
        setTagMenuOpen(false)
      }
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [tagMenuOpen])

  const selectedMeta = advisoryMeta(announcement.tag)
  const TagIcon = selectedMeta.icon

  return (
    <section className="rounded-2xl border border-line-tint bg-white p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-brand-orange-soft text-brand-orange">
          <MegaphoneIcon className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold text-brand-navy">{editing ? "Edit announcement" : "New announcement"}</h2>
          <p className="text-xs font-semibold text-subtle-foreground">What residents need to know, and where it applies</p>
        </div>
      </div>

      <form className="mt-5 grid gap-3" onSubmit={save}>
        <input
          required
          maxLength={160}
          value={announcement.title}
          onChange={(e) => setAnnouncement((v) => ({ ...v, title: e.target.value }))}
          placeholder="Announcement title"
          className={cn(inputClass, "text-base")}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Advisory type — a dropdown with icons instead of a free-text tag. */}
          <div className="relative">
            <span className={labelClass}>Type</span>
            <button
              type="button"
              onClick={() => setTagMenuOpen((open) => !open)}
              className={cn(inputClass, "mt-1 flex w-full items-center gap-2 text-left")}
              aria-haspopup="listbox"
              aria-expanded={tagMenuOpen}
            >
              <span className="flex size-5 items-center justify-center rounded-md bg-neutral-100 text-neutral-600">
                <TagIcon className="size-3.5" />
              </span>
              <span className="flex-1 truncate">{announcement.tag}</span>
              <ChevronDownIcon className={cn("size-4 text-navy-muted transition-transform", tagMenuOpen && "rotate-180")} />
            </button>
            {tagMenuOpen ? (
              <div
                ref={tagMenuRef}
                className="absolute left-0 right-0 top-full z-[1200] mt-1 overflow-hidden rounded-xl border border-line-tint bg-white py-1 shadow-lg"
                role="listbox"
              >
                {ADVISORY_TAGS.map((meta) => {
                  const Icon = meta.icon
                  return (
                    <button
                      key={meta.value}
                      type="button"
                      role="option"
                      aria-selected={announcement.tag === meta.value}
                      onClick={() => {
                        setAnnouncement((v) => ({ ...v, tag: meta.value }))
                        setTagMenuOpen(false)
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold text-brand-navy transition-colors hover:bg-canvas"
                    >
                      <span className="flex size-6 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                        <Icon className="size-3.5" />
                      </span>
                      {meta.label}
                      {announcement.tag === meta.value ? (
                        <CheckIcon className="ml-auto size-4 text-neutral-500" strokeWidth={2.2} />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>

          <label className={labelClass}>
            Audience
            <select
              value={announcement.audience}
              onChange={(e) => setAnnouncement((v) => ({ ...v, audience: e.target.value as Announcement["audience"] }))}
              className={cn(inputClass, "mt-1")}
            >
              <option value="all">All users</option>
              <option value="residents">Residents only</option>
              <option value="responders">Responders only</option>
              <option value="officials">Officials only</option>
            </select>
          </label>
        </div>

        <textarea
          required
          maxLength={3000}
          rows={3}
          value={announcement.body}
          onChange={(e) => setAnnouncement((v) => ({ ...v, body: e.target.value }))}
          placeholder="Information residents need to know"
          className="resize-none rounded-xl border border-line-tint p-3 text-sm font-semibold text-brand-navy outline-none focus:border-brand-orange"
        />

        {/* Affected area */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold text-navy-muted">Affected area</span>
            <span className="text-[11px] font-semibold text-subtle-foreground">
              {area.streets.length > 0 ? `${area.streets.length} street${area.streets.length === 1 ? "" : "s"} marked` : "Optional"}
            </span>
          </div>
          <AreaPicker context={areaContext} value={area} onChange={setArea} tag={announcement.tag} />
        </div>

        {/* Exact place — for advisories about one spot, not a corridor. */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold text-navy-muted">Exact place</span>
            <span className="text-[11px] font-semibold text-subtle-foreground">
              {place ? "Pinned" : "Optional"}
            </span>
          </div>
          {place ? (
            <div className="flex items-center gap-2 rounded-xl border border-line-tint p-3">
              <MapPinIcon className="size-4 shrink-0 text-navy-muted" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-navy">
                {place.label}
              </span>
              <button
                type="button"
                onClick={() => setPlacePickerOpen(true)}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-navy-muted hover:bg-canvas"
              >
                Move
              </button>
              <button
                type="button"
                onClick={() => setPlace(null)}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-navy-muted hover:bg-canvas"
              >
                Clear
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPlacePickerOpen(true)}
              className="flex w-full items-center gap-2 rounded-xl border border-dashed border-line-tint p-3 text-sm font-semibold text-navy-muted transition-colors hover:bg-canvas"
            >
              <MapPinIcon className="size-4" />
              Pin a specific place
            </button>
          )}
        </div>

        <LocationPickerModal
          open={placePickerOpen}
          onClose={() => setPlacePickerOpen(false)}
          initialLat={place?.lat ?? null}
          initialLng={place?.lng ?? null}
          initialAddress={place?.label ?? ""}
          onConfirm={(payload) => {
            setPlace({ lat: payload.lat, lng: payload.lng, label: payload.address })
            setPlacePickerOpen(false)
          }}
        />

        {/* Secondary fields tucked away so the form reads as: what, who, where. */}
        <div className="overflow-hidden rounded-xl border border-line-tint">
          <button
            type="button"
            onClick={() => setOptionsOpen((open) => !open)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold text-navy-muted transition-colors hover:bg-canvas"
            aria-expanded={optionsOpen}
          >
            <SlidersHorizontalIcon className="size-3.5" />
            More options
            <span className="ml-auto text-[10px] font-semibold normal-case tracking-normal text-subtle-foreground">
              schedule · urgency · banner · pin
            </span>
            <ChevronDownIcon className={cn("size-4 transition-transform", optionsOpen && "rotate-180")} />
          </button>
          {optionsOpen ? (
            <div className="grid gap-3 border-t border-line-tint p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelClass}>
                  Starts (optional)
                  <input
                    type="datetime-local"
                    value={announcement.starts_at}
                    onChange={(e) => setAnnouncement((v) => ({ ...v, starts_at: e.target.value }))}
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  Expires (optional)
                  <input
                    type="datetime-local"
                    value={announcement.expires_at}
                    onChange={(e) => setAnnouncement((v) => ({ ...v, expires_at: e.target.value }))}
                    className={inputClass}
                  />
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  value={announcement.urgency}
                  onChange={(e) => setAnnouncement((v) => ({ ...v, urgency: e.target.value as Announcement["urgency"] }))}
                  className={inputClass}
                >
                  <option value="normal">Normal</option>
                  <option value="important">Important</option>
                  <option value="urgent">Urgent</option>
                </select>
                <label className="flex h-11 items-center gap-2 rounded-xl border border-line-tint px-3 text-sm font-bold text-navy-muted">
                  <input
                    type="checkbox"
                    checked={announcement.is_pinned}
                    onChange={(e) => setAnnouncement((v) => ({ ...v, is_pinned: e.target.checked }))}
                    className="size-4 accent-brand-orange"
                  />
                  Pin to top
                </label>
              </div>
              <label className={labelClass}>
                Banner image (optional)
                <span className="flex h-11 items-center gap-2 rounded-xl border border-line-tint px-3 text-sm font-semibold text-navy-muted">
                  <ImageIcon className="size-4" />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setAnnouncementImage(e.target.files?.[0] ?? null)}
                    className="min-w-0 flex-1 text-xs font-semibold"
                  />
                </span>
              </label>
              <label className={labelClass}>
                Image alt text
                <input
                  maxLength={160}
                  value={announcement.image_alt}
                  onChange={(e) => setAnnouncement((v) => ({ ...v, image_alt: e.target.value }))}
                  placeholder="Describe the banner for screen readers"
                  className={inputClass}
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy === "save"} className="bg-brand-navy text-white hover:bg-brand-navy/80">
            <PlusIcon className="size-4" />
            {busy === "save" ? "Saving…" : editing ? "Save changes" : "Create announcement"}
          </Button>
          <label className="flex h-10 items-center gap-2 rounded-xl border border-line-tint px-3 text-sm font-bold text-navy-muted">
            <input
              type="checkbox"
              checked={announcement.is_published}
              onChange={(e) => setAnnouncement((v) => ({ ...v, is_published: e.target.checked }))}
              className="size-4 accent-brand-orange"
            />
            Publish now
            <CalendarDaysIcon className="size-3.5 text-navy-muted" />
          </label>
          {editing ? (
            <Button type="button" variant="outline" onClick={reset}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </section>
  )
}
