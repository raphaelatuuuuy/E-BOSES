import { useState } from "react"
import {
  AlertTriangleIcon,
  AmbulanceIcon,
  FlameIcon,
  ShieldAlertIcon,
  CloudLightningIcon,
  ImageIcon,
  MapPinIcon,
  PhoneIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from "@/features/dashboard/components/dialog"

const emergencies = [
  { label: "Medical", icon: AmbulanceIcon, desc: "Injury, illness, rescue", color: "blue" },
  { label: "Fire", icon: FlameIcon, desc: "Building, forest, vehicle", color: "orange" },
  { label: "Crime", icon: ShieldAlertIcon, desc: "Assault, theft, threat", color: "red" },
  { label: "Disaster", icon: CloudLightningIcon, desc: "Flood, quake, storm", color: "purple" },
] as const

const emergencyColorMap: Record<string, { border: string; bg: string; text: string; iconBg: string }> = {
  blue: { border: "border-blue-500", bg: "bg-blue-50", text: "text-blue-700", iconBg: "bg-blue-100" },
  red: { border: "border-red-500", bg: "bg-red-50", text: "text-red-700", iconBg: "bg-red-100" },
  orange: { border: "border-orange-500", bg: "bg-orange-50", text: "text-orange-700", iconBg: "bg-orange-100" },
  purple: { border: "border-purple-500", bg: "bg-purple-50", text: "text-purple-700", iconBg: "bg-purple-100" },
}

export function SOSButton() {
  const [open, setOpen] = useState(false)
  const [emergency, setEmergency] = useState("")
  const [showMap, setShowMap] = useState(false)

  return (
    <>
      {/* Floating SOS circle */}
      <div className="group fixed bottom-24 right-6 z-40 motion-safe:animate-sos-drop md:bottom-6">
        <span className="absolute inset-0 rounded-full bg-red-500/30 motion-safe:animate-sos-ping" />
        <span className="absolute inset-0 rounded-full bg-red-500/20 motion-safe:animate-sos-ping-delayed" />

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="relative flex size-20 flex-col items-center justify-center rounded-full border-2 border-red-300 bg-gradient-to-br from-red-300 via-red-500 to-red-800 text-white shadow-[0_0_20px_rgba(220,38,38,0.5)] transition-all duration-300 hover:scale-110 hover:shadow-[0_0_30px_rgba(220,38,38,0.7)] active:scale-95"
        >
          <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/20 to-transparent" />
          <PhoneIcon className="relative size-7 drop-shadow-sm" fill="currentColor" />
          <span className="relative mt-0.5 text-base font-extrabold tracking-widest drop-shadow-sm">SOS</span>
        </button>

        <span className="pointer-events-none absolute right-full top-1/2 mr-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          Emergency SOS
        </span>
      </div>

      {/* Emergency dialog */}
      <Dialog open={open} onClose={() => setOpen(false)} maxW="max-w-4xl">
        {/* Header — dark red */}
        <DialogHeader className="border-red-800 bg-red-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="relative flex size-10 items-center justify-center">
                <span className="absolute inset-0 rounded-full bg-card/30 motion-safe:animate-sos-ping" />
                <span className="absolute inset-0 rounded-full bg-card/20 motion-safe:animate-sos-ping-delayed" />
                <div className="relative flex size-10 items-center justify-center rounded-full border-2 border-red-300 bg-gradient-to-br from-red-300 via-red-500 to-red-800 shadow-[0_0_10px_rgba(220,38,38,0.4)]">
                  <div className="flex flex-col items-center">
                    <PhoneIcon className="size-4 rotate-[135deg] text-white drop-shadow-sm" fill="currentColor" />
                    <span className="text-[8px] font-extrabold tracking-widest text-white drop-shadow-sm">SOS</span>
                  </div>
                </div>
              </div>
              <DialogTitle className="text-white">Send Emergency Alert</DialogTitle>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex size-8 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-card/10 hover:text-white"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </DialogHeader>

        {/* Body — two columns */}
        <DialogBody className="md:grid md:grid-cols-2 md:gap-6">
          {/* Left: Emergency + Note */}
          <div className="flex h-full flex-col space-y-5">
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground">What's the emergency?</label>
              <div className="grid grid-cols-2 gap-2">
                {emergencies.map((e) => {
                  const Icon = e.icon
                  const selected = emergency === e.label
                  const colors = emergencyColorMap[e.color]
                  return (
                    <button
                      key={e.label}
                      type="button"
                      onClick={() => setEmergency(e.label)}
                      className={cn(
                        "group flex flex-col items-center gap-1.5 rounded-xl border-2 bg-card p-3 text-center transition-all",
                        selected
                          ? cn(colors.border, colors.bg, colors.text)
                          : "border-border text-muted-foreground hover:border-primary hover:bg-primary/5 hover:text-primary",
                      )}
                    >
                      <div
                        className={cn(
                          "flex size-8 items-center justify-center rounded-full transition-colors",
                          selected ? colors.iconBg : "bg-muted group-hover:bg-primary/10",
                        )}
                      >
                        <Icon className="size-4" />
                      </div>
                      <span className="text-xs font-semibold">{e.label}</span>
                      <span className="text-xs leading-tight opacity-70">{e.desc}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-1 flex-col space-y-2">
              <label className="text-sm font-medium text-foreground">Add a note</label>
              <textarea
                placeholder="Any additional details for responders..."
                className="h-full min-h-[180px] w-full resize-none rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {/* Right: Media + Location */}
          <div className="flex h-full flex-col space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">
                  Add media <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <span className="text-xs text-muted-foreground">Help Responders</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-card text-muted-foreground transition-colors hover:border-red-400 hover:text-red-600">
                  <ImageIcon className="size-5" />
                  <span className="text-xs font-medium">Photo or Video</span>
                </button>
                <button type="button" className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-card text-muted-foreground transition-colors hover:border-red-400 hover:text-red-600">
                  <PlusIcon className="size-5" />
                  <span className="text-xs font-medium">Add more</span>
                </button>
              </div>
            </div>

            <div className="flex flex-1 flex-col space-y-2">
              <label className="text-sm font-medium text-foreground">Location</label>
              <div className="relative">
                <MapPinIcon className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search or pin location"
                  className="w-full rounded-lg border border-border bg-card py-2.5 pl-10 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div className="relative min-h-[180px] flex-1">
                {showMap ? (
                  <div className="absolute inset-0 overflow-hidden rounded-lg border border-border">
                    <iframe title="Location map" src="https://www.openstreetmap.org/export/embed.html?bbox=120.9%2C14.5%2C121.1%2C14.7&layer=mapnik" className="h-full w-full border-0" />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowMap(true)}
                    className="flex h-full w-full items-center justify-center rounded-lg border border-border bg-muted transition-colors hover:border-primary hover:bg-primary/5"
                  >
                    <div className="flex flex-col items-center gap-1 text-muted-foreground">
                      <MapPinIcon className="size-6" />
                      <span className="text-xs">Click to load map</span>
                    </div>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 md:col-span-2">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <p className="text-xs leading-relaxed text-amber-800">
              False or misleading alerts are logged and may lead to account suspension or legal consequences.
            </p>
          </div>
        </DialogBody>

        {/* Footer — dark red */}
        <DialogFooter className="border-red-800 bg-red-700">
          <div className="flex w-full items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg bg-card px-6 py-2.5 text-sm font-semibold text-red-700 shadow-sm transition-colors hover:bg-card/90 active:scale-[0.98]"
            >
              Back
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:scale-[0.98]"
            >
              Review
            </button>
          </div>
        </DialogFooter>
      </Dialog>
    </>
  )
}
