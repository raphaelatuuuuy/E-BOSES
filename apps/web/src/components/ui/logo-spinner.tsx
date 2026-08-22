import { cn } from "@workspace/ui/lib/utils"

export function LogoSpinner({ className }: { className?: string }) {
  return (
    <div role="status" className={cn("relative inline-flex size-90 items-center justify-center", className)}>
      <div
        className="absolute inset-0 animate-spin rounded-full"
        style={{
          background:
            "conic-gradient(from 0deg, color-mix(in srgb, var(--primary) 18%, transparent) 0deg 130deg, var(--primary) 130deg 360deg)",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
        }}
      />
      <span className="sr-only">Loading…</span>
    </div>
  )
}
