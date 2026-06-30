import { useState } from "react"
import {
  CheckIcon,
  ImageIcon,
  MapPinIcon,
  PlusIcon,
  ShareIcon,
  WrenchIcon,
  TreePineIcon,
  ShieldCheckIcon,
  MoreHorizontalIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"

import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from "@/features/dashboard/components/dialog"

const concerns = [
  { label: "Infrastructure", icon: WrenchIcon, desc: "Roads, utilities, buildings", color: "blue" },
  { label: "Environment", icon: TreePineIcon, desc: "Pollution, waste, nature", color: "green" },
  { label: "Public Safety", icon: ShieldCheckIcon, desc: "Crime, hazards, alerts", color: "red" },
  { label: "Others", icon: MoreHorizontalIcon, desc: "Any other concern", color: "gray" },
] as const

const colorMap: Record<string, { border: string; bg: string; text: string; iconBg: string }> = {
  blue: { border: "border-blue-500", bg: "bg-blue-50", text: "text-blue-700", iconBg: "bg-blue-100" },
  green: { border: "border-green-500", bg: "bg-green-50", text: "text-green-700", iconBg: "bg-green-100" },
  red: { border: "border-red-500", bg: "bg-red-50", text: "text-red-700", iconBg: "bg-red-100" },
  gray: { border: "border-gray-400", bg: "bg-gray-50", text: "text-gray-700", iconBg: "bg-gray-100" },
}

export function CreateReportDialog({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
} = {}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (v: boolean) => {
    setInternalOpen(v)
    onOpenChange?.(v)
  }
  const [concern, setConcern] = useState("")
  const [description, setDescription] = useState("")
  const [shareOpen, setShareOpen] = useState(false)
  const [shareChoice, setShareChoice] = useState<"yes" | "no" | null>(null)
  const [showMap, setShowMap] = useState(false)
  const maxChars = 150

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary active:text-primary"
      >
        <PlusIcon className="size-5" />
        Create Report
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} maxW="max-w-4xl">
        {/* Header */}
        <DialogHeader className="border-[#0a1a5e] bg-[#020c4e]">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-white">Create Report</DialogTitle>
            <div className="flex items-center gap-1">
              <div className="relative">
                <Popover open={shareOpen} onOpenChange={setShareOpen}>
                  <PopoverTrigger
                    className={cn(
                      "flex size-8 items-center justify-center rounded-lg transition-colors",
                      shareOpen
                        ? "bg-white/10 text-white"
                        : "text-white/60 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <ShareIcon className="size-4" />
                  </PopoverTrigger>

                  <PopoverContent className="w-72 right-0 left-auto top-full mt-2">
                    <div className="p-4 space-y-4">
                      <div className="flex items-center gap-2">
                        <div className="flex size-8 items-center justify-center rounded-full bg-primary/10">
                          <ShareIcon className="size-4 text-primary" />
                        </div>
                        <h4 className="text-sm font-semibold text-foreground">Share with community?</h4>
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Choose how your report will be visible. You can always change this later in settings.
                      </p>
                      <div className="space-y-2">
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                            shareChoice === "yes" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                          )}
                        >
                          <div
                            className={cn(
                              "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                              shareChoice === "yes" ? "border-primary bg-primary" : "border-muted-foreground",
                            )}
                          >
                            {shareChoice === "yes" && <CheckIcon className="size-3 text-white" />}
                          </div>
                          <input type="checkbox" checked={shareChoice === "yes"} onChange={() => setShareChoice(shareChoice === "yes" ? null : "yes")} className="sr-only" />
                          <div>
                            <p className="text-sm font-medium text-foreground">Yes, share to community feed</p>
                            <p className="text-xs text-muted-foreground">Others can see and engage with your report.</p>
                          </div>
                        </label>
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                            shareChoice === "no" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                          )}
                        >
                          <div
                            className={cn(
                              "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                              shareChoice === "no" ? "border-primary bg-primary" : "border-muted-foreground",
                            )}
                          >
                            {shareChoice === "no" && <CheckIcon className="size-3 text-white" />}
                          </div>
                          <input type="checkbox" checked={shareChoice === "no"} onChange={() => setShareChoice(shareChoice === "no" ? null : "no")} className="sr-only" />
                          <div>
                            <p className="text-sm font-medium text-foreground">No, keep it private</p>
                            <p className="text-xs text-muted-foreground">Only you and the admin can view this report.</p>
                          </div>
                        </label>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex size-8 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* Body — two columns */}
        <DialogBody className="md:grid md:grid-cols-2 md:gap-6">
          {/* Left: Concern + Subject + Description */}
          <div className="flex h-full flex-col space-y-5">
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground">What's the concern?</label>
              <div className="grid grid-cols-2 gap-2">
                {concerns.map((c) => {
                  const Icon = c.icon
                  const selected = concern === c.label
                  const colors = colorMap[c.color]
                  return (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => setConcern(c.label)}
                      className={cn(
                        "group flex flex-col items-center gap-1.5 rounded-xl border-2 bg-white p-3 text-center transition-all",
                        selected
                          ? cn(colors.border, colors.bg, colors.text)
                          : "border-border text-muted-foreground hover:border-primary hover:bg-primary/5 hover:text-primary",
                      )}
                    >
                      <div className={cn("flex size-8 items-center justify-center rounded-full transition-colors", selected ? colors.iconBg : "bg-muted group-hover:bg-primary/10")}>
                        <Icon className="size-4" />
                      </div>
                      <span className="text-xs font-semibold">{c.label}</span>
                      <span className="text-[10px] leading-tight opacity-70">{c.desc}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Subject</label>
              <input
                type="text"
                placeholder="Brief summary of the issue"
                className="w-full rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="flex flex-1 flex-col space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">What Happened?</label>
                <span className={cn("text-xs", description.length >= maxChars ? "text-destructive" : "text-muted-foreground")}>
                  {description.length}/{maxChars}
                </span>
              </div>
              <textarea
                maxLength={maxChars}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the issue in detail..."
                className="h-full min-h-[120px] w-full resize-none rounded-lg border border-border bg-white px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          {/* Right: Media + Location */}
          <div className="flex h-full flex-col space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">
                Add media <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-white text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                  <ImageIcon className="size-5" />
                  <span className="text-[10px] font-medium">Photo or Video</span>
                </button>
                <button type="button" className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-white text-muted-foreground transition-colors hover:border-primary hover:text-primary">
                  <PlusIcon className="size-5" />
                  <span className="text-[10px] font-medium">Add more</span>
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
                  className="w-full rounded-lg border border-border bg-white py-2.5 pl-10 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <button
                type="button"
                onClick={() => setShowMap(true)}
                className={cn(
                  "flex w-full flex-1 overflow-hidden rounded-lg border border-border bg-muted",
                  showMap ? "hidden" : "items-center justify-center",
                )}
              >
                <div className="flex flex-col items-center gap-1 text-muted-foreground">
                  <MapPinIcon className="size-6" />
                  <span className="text-xs">Click to load map</span>
                </div>
              </button>
              {showMap && (
                <div className="flex-1 overflow-hidden rounded-lg border border-border">
                  <iframe title="Location map" src="https://www.openstreetmap.org/export/embed.html?bbox=120.9%2C14.5%2C121.1%2C14.7&layer=mapnik" className="h-full w-full border-0" />
                </div>
              )}
            </div>
          </div>
        </DialogBody>

        {/* Footer */}
        <DialogFooter className="border-[#0a1a5e] bg-[#020c4e]">
          <div className="flex w-full items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg bg-white px-6 py-2.5 text-sm font-semibold text-[#020c4e] shadow-sm transition-colors hover:bg-white/90 active:scale-[0.98]"
            >
              Back
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:scale-[0.98]"
            >
              Submit
            </button>
          </div>
        </DialogFooter>
      </Dialog>
    </>
  )
}
