// apps/web/src/features/landing/scenes/voice-journey.tsx
import { useRef } from "react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"
import { CameraIcon, ConstructionIcon, MapPinIcon } from "lucide-react"

import { MM } from "../landing-theme"

const STATIONS = [
  ["Submitted", "Add a photo, a short description, and the location of the concern."],
  ["Received", "The barangay confirms your report arrived and sends it to the right office or responder."],
  ["Assigned", "Your report shows who is responsible and includes each dated status update."],
  ["Resolved", "The final update records the action taken and the date the report was completed."],
] as const

/*
 * Timeline geometry (exact by construction, no measuring needed):
 * each station dot is 14px (size-3.5) at top-[5px] inside its li, so its center
 * sits at x=7px, y=12px. Every li except the last renders one connector segment
 * from its own dot center (top-[12px]) to the next li's dot center, which is
 * exactly the 2rem list gap (space-y-8) plus 12px below this li's bottom edge:
 * bottom-[calc(-2rem_-_12px)]. The orange fill inside each segment slides down
 * (yPercent) under overflow-hidden, so the drawn tip arrives at a dot precisely
 * when that segment's tween completes, and the dot lights at that moment.
 */
export function VoiceJourney() {
  const root = useRef<HTMLElement | null>(null)
  const trackingRef = useRef<HTMLSpanElement | null>(null)

  useGSAP(
    () => {
      const scope = root.current
      if (!scope) return

      const stations = gsap.utils.toArray<HTMLElement>(".vj-station", scope)
      const stationBodies = gsap.utils.toArray<HTMLElement>(".vj-station-body", scope)
      const dotFills = gsap.utils.toArray<HTMLElement>(".vj-dot-fill", scope)
      const segFills = gsap.utils.toArray<HTMLElement>(".vj-seg-fill", scope)
      const phone = scope.querySelector<HTMLElement>(".vj-phone")

      // Phone-mock beats: the card scales in, then one scan line sweeps the WHOLE
      // card top to bottom and each element resolves as the line reaches it. The
      // offsets below are that line's position expressed in seconds: the sweep
      // runs SCAN_SPAN seconds for 0->100%, so a beat placed at "scan+=t" fires
      // when the line is t/SCAN_SPAN of the way down. The fractions come from the
      // card's own stacking order (photo ~27%, description ~64%, pin ~87%), so
      // the reveals stay glued to the line even though nothing is measured.
      // The .set() bookends keep the line hidden at both rest states, which
      // matters because the whole timeline is scrubbed and can rewind.
      const SCAN_SPAN = 1.4
      const addMockBeats = (tl: gsap.core.Timeline) => {
        if (trackingRef.current) trackingRef.current.textContent = "EB-2026-0000"
        const counter = { n: 0 }
        tl.from(".vj-photo", { scale: 0.85, opacity: 0, duration: 0.8 })
          .addLabel("scan")
          .set(".vj-scan", { opacity: 1 }, "scan")
          .fromTo(
            ".vj-scan",
            { top: "0%" },
            { top: "100%", duration: SCAN_SPAN, ease: "none" },
            "scan",
          )
          .fromTo(
            ".vj-cam",
            { opacity: 1, scale: 1 },
            { opacity: 0, scale: 0.85, duration: 0.3 },
            "scan+=0.26",
          )
          .from(".vj-category", { opacity: 0, scale: 0.85, duration: 0.35 }, "scan+=0.34")
          .from(
            ".vj-desc-seg",
            {
              scaleX: 0,
              transformOrigin: "left center",
              stagger: 0.08,
              duration: 0.3,
            },
            "scan+=0.86",
          )
          .from(
            ".vj-chip",
            { scale: 0.4, opacity: 0, stagger: 0.15, duration: 0.3 },
            "scan+=0.98",
          )
          .from(
            ".vj-pin",
            { y: -30, opacity: 0, ease: "bounce.out", duration: 0.7 },
            "scan+=1.18",
          )
          .set(".vj-scan", { opacity: 0 }, `scan+=${SCAN_SPAN}`)
          .from(".vj-tracking", { opacity: 0, duration: 0.4 })
          .to(
            counter,
            {
              n: 142,
              duration: 1.2,
              ease: "none",
              onUpdate: () => {
                if (trackingRef.current)
                  trackingRef.current.textContent = `EB-2026-${String(Math.round(counter.n)).padStart(4, "0")}`
              },
            },
            "<",
          )
      }

      // Station i lights exactly when the drawn tip reaches its dot, then its
      // segment draws toward the next dot (which lights when the draw completes).
      // Only the text body slides (not the li), so dots and segments never move
      // and the tip geometry stays exact while the copy parallaxes up into place.
      const addStationBeats = (tl: gsap.core.Timeline) => {
        stations.forEach((_, i) => {
          tl.from(dotFills[i], { scale: 0, opacity: 0, duration: 0.25 }).from(
            stationBodies[i],
            { opacity: 0.15, y: 24, duration: 0.6, ease: "power1.out" },
            "<",
          )
          if (i < segFills.length)
            tl.from(segFills[i], { yPercent: -101, duration: 0.8, ease: "none" })
        })
      }

      const mm = gsap.matchMedia()

      // Desktop: the section is exactly one viewport tall (md:h-svh), so the
      // pinned frame is never cut off. The mock beats and the station reveals
      // run as parallel child timelines under one scrub, so the list parallaxes
      // in WHILE the report graphics play; the station pass is stretched to the
      // mock's duration so the line finishes drawing (and the pin releases)
      // exactly when the tracking counter lands.
      mm.add(MM.desktop, () => {
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: scope,
            start: "top top",
            end: "+=2400",
            pin: true,
            scrub: 0.5,
            anticipatePin: 1,
          },
        })
        const mockTl = gsap.timeline()
        addMockBeats(mockTl)
        const stationTl = gsap.timeline()
        addStationBeats(stationTl)
        stationTl.duration(mockTl.duration())
        tl.add(mockTl, 0).add(stationTl, 0)
      })

      // Mobile: parallax without a pin (the stacked layout is taller than a
      // phone viewport, so pinning would clip it). Every beat is scrubbed to
      // scroll position instead: the mock plays as the phone card travels up
      // the screen, and each station's incoming segment draws on approach so
      // its dot lights exactly when the line arrives. Scrolling back rewinds.
      mm.add(MM.mobile, () => {
        const mockTl = gsap.timeline({
          scrollTrigger: {
            trigger: phone ?? scope,
            start: "top 88%",
            end: "top 28%",
            scrub: 0.4,
          },
        })
        addMockBeats(mockTl)

        stations.forEach((station, i) => {
          const tl = gsap.timeline({
            scrollTrigger: { trigger: station, start: "top 94%", end: "top 55%", scrub: 0.4 },
          })
          if (i > 0) tl.from(segFills[i - 1], { yPercent: -101, duration: 0.5, ease: "none" })
          tl.from(dotFills[i], { scale: 0, opacity: 0, duration: 0.2 }).from(
            stationBodies[i],
            { opacity: 0.15, y: 24, duration: 0.4, ease: "power1.out" },
            "<",
          )
        })
      })

      // MM.reduced gets no context on purpose: the static DOM state is the
      // finished one (line fully drawn, all dots lit, chips visible, scan line
      // hidden, camera placeholder already swapped for the category, tracking
      // number at its final value) and nothing pins.
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <section
      ref={root}
      id="how-it-works"
      data-anchor="features"
      className="relative scroll-mt-24 overflow-hidden px-5 py-20 md:h-svh md:px-10 md:py-0"
    >
      <div className="mx-auto grid max-w-7xl content-center gap-12 md:h-full md:grid-cols-[0.9fr_1.1fr] md:items-center md:gap-10">
        {/* Left/top: header + phone mock */}
        <div className="text-center md:text-left">
          <p className="mb-3 font-mono text-xs font-bold uppercase tracking-[0.3em] text-accent">
            How E-Boses works
          </p>
          <h2 className="font-heading text-[clamp(1.8rem,3.5vw,3rem)] font-bold leading-tight">
            Follow a report from submission to resolution.
          </h2>
          <span
            ref={trackingRef}
            className="vj-tracking mt-5 inline-block border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-sm text-primary"
          >
            EB-2026-0142
          </span>

          {/* Phone mock: photo under review, highlighted description, location, severity */}
          <div className="vj-phone relative mx-auto mt-8 w-64 overflow-hidden rounded-3xl border border-white/15 bg-white/[0.04] p-4 shadow-2xl backdrop-blur-sm md:mx-0">
            <div className="vj-photo relative flex h-28 items-center justify-center overflow-hidden rounded-xl bg-white/10">
              <CameraIcon className="vj-cam size-8 text-white/40 opacity-0" strokeWidth={1.5} aria-hidden />
              <div className="vj-category absolute inset-0 flex flex-col items-center justify-center">
                <ConstructionIcon className="size-8 text-primary" strokeWidth={1.5} aria-hidden />
                <span className="mt-1 font-mono text-[8px] uppercase tracking-[0.25em] text-primary">
                  Infrastructure
                </span>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <div className="vj-desc-line flex h-3.5 items-center gap-1.5">
                <span className="vj-desc-seg h-2 w-10 rounded-sm bg-white/20" aria-hidden />
                <span className="vj-chip border border-accent/50 bg-accent/15 px-1 font-mono text-[9px] leading-[13px] text-primary">
                  lubak
                </span>
                <span className="vj-desc-seg h-2 flex-1 rounded-sm bg-white/20" aria-hidden />
              </div>
              <div className="vj-desc-line flex h-3.5 items-center gap-1.5">
                <span className="vj-desc-seg h-2 flex-1 rounded-sm bg-white/20" aria-hidden />
                <span className="vj-chip border border-landing-sky/50 bg-landing-sky/15 px-1 font-mono text-[9px] leading-[13px] text-landing-sky">
                  kalsada
                </span>
                <span className="vj-desc-seg h-2 w-8 rounded-sm bg-white/20" aria-hidden />
              </div>
              <div className="vj-desc-line flex h-3.5 items-center">
                <span className="vj-desc-seg h-2 w-3/5 rounded-sm bg-white/20" aria-hidden />
              </div>
            </div>
            <div className="vj-pin mt-3.5 flex items-center gap-2 rounded-lg bg-accent/15 px-3 py-2 text-sm text-primary">
              <MapPinIcon className="size-4" strokeWidth={1.5} aria-hidden /> Marikina Heights
            </div>
            {/* Sweeps the whole card, not just the photo; clipped by the card's
                own overflow-hidden so it never bleeds past the rounded edges. */}
            <span
              aria-hidden
              className="vj-scan pointer-events-none absolute inset-x-0 top-0 h-px bg-accent opacity-0 shadow-[0_0_10px_2px_rgba(255,80,3,0.55)]"
            />
          </div>
        </div>

        {/* Right/bottom: stations with a connector line running exactly through the dot centers */}
        <ol className="space-y-8">
          {STATIONS.map(([label, body], i) => (
            <li key={label} className="vj-station relative pl-9">
              {i < STATIONS.length - 1 && (
                <span
                  aria-hidden
                  className="absolute left-[6.5px] top-[12px] bottom-[calc(-2rem_-_12px)] w-px overflow-hidden bg-white/10"
                >
                  <span className="vj-seg-fill absolute inset-0 bg-accent shadow-[0_0_8px_rgba(255,80,3,0.8)]" />
                </span>
              )}
              <span
                aria-hidden
                className="absolute left-0 top-[5px] z-10 flex size-3.5 items-center justify-center rounded-full border border-accent/60 bg-landing-bg"
              >
                <span className="vj-dot-fill size-2 rounded-full bg-accent shadow-[0_0_10px_rgba(255,80,3,0.9)]" />
              </span>
              <div className="vj-station-body">
                <span className="font-mono text-xs uppercase tracking-[0.25em] text-primary">
                  0{i + 1} · {label}
                </span>
                <p className="mt-1.5 max-w-md text-sm leading-relaxed text-white/60 md:text-base">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}