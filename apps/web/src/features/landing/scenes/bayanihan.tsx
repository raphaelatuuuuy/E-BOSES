// apps/web/src/features/landing/scenes/bayanihan.tsx
import { useRef } from "react"
import gsap from "gsap"
import { useGSAP } from "@gsap/react"

import { MM } from "../landing-theme"

type Tone = "solid" | "ghost" | "accent"
type MarqueeWord = { text: string; tone: Tone; chip?: string }

// Row A: everyday concerns. Row B: emergencies.
const WORDS_A: MarqueeWord[] = [
  { text: "Sirang poste ng ilaw", tone: "solid" },
  { text: "Basurang naiwan", tone: "ghost" },
  { text: "Lubak sa kalsada", tone: "solid", chip: "CONCERN" },
  { text: "Baradong kanal", tone: "accent" },
  { text: "Ingay sa gabi", tone: "ghost" },
  { text: "Gumagalang aso", tone: "solid" },
]

const WORDS_B: MarqueeWord[] = [
  { text: "Baha", tone: "ghost" },
  { text: "Sunog", tone: "accent", chip: "EMERGENCY" },
  { text: "Medikal na tulong", tone: "solid" },
  { text: "Aksidente sa daan", tone: "ghost" },
]

const ROLES: ReadonlyArray<readonly [string, string]> = [
  ["Residents", "Report local concerns, send emergency alerts, and check updates."],
  ["Barangay staff", "Review reports, prioritize alerts, and keep residents informed."],
  ["Responders", "Receive emergency details and locations before responding."],
] as const

function toneClass(tone: Tone): string {
  if (tone === "accent") return "text-[#ff5003]"
  if (tone === "ghost") return "text-transparent"
  return "text-[#f5f2ec]"
}

function WordMarqueeRow({ words, reverse = false }: { words: MarqueeWord[]; reverse?: boolean }) {
  // Double the sequence so the base run is wider than any viewport, then
  // duplicate that run so xPercent: -50 loops seamlessly.
  const half = [...words, ...words]
  const track = [...half, ...half]
  return (
    <div
      aria-hidden
      className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]"
    >
      {/* No gap on the track: each item carries its own trailing padding so the
          item width includes the spacing and xPercent: -50 lands exactly on the
          repeat period (a flex gap would make the loop wrap jump by half a gap). */}
      <div className={`bay-marquee flex w-max items-center ${reverse ? "bay-marquee-reverse" : ""}`}>
        {track.map((w, i) => (
          <span key={`${w.text}-${i}`} className="flex items-center gap-6 whitespace-nowrap pr-6 md:gap-10 md:pr-10">
            <span
              className={`font-heading text-4xl font-bold leading-[1.15] md:text-5xl ${toneClass(w.tone)}`}
              style={w.tone === "ghost" ? { WebkitTextStroke: "1px rgba(245,242,236,0.25)" } : undefined}
            >
              {w.text}
            </span>
            {w.chip ? (
              <span className="border border-[#ff5003]/40 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-[#ff8133]">
                {w.chip}
              </span>
            ) : null}
            <span className="font-mono text-lg text-white/20">{i % 2 === 0 ? "·" : "/"}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function Bayanihan() {
  const root = useRef<HTMLElement | null>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      const play = () => {
        gsap.to(".bay-marquee:not(.bay-marquee-reverse)", { xPercent: -50, duration: 36, ease: "none", repeat: -1 })
        gsap.fromTo(".bay-marquee-reverse", { xPercent: -50 }, { xPercent: 0, duration: 36, ease: "none", repeat: -1 })
        gsap.utils.toArray<HTMLElement>(".bay-reveal").forEach((el) => {
          gsap.from(el, {
            y: 32, opacity: 0, duration: 0.8, ease: "power2.out",
            scrollTrigger: { trigger: el, start: "top 80%" },
          })
        })
        gsap.utils.toArray<HTMLElement>(".bay-role").forEach((row) => {
          gsap.from(row, {
            y: 40, opacity: 0, duration: 0.8, ease: "power2.out",
            scrollTrigger: { trigger: row, start: "top 85%" },
          })
        })
      }
      mm.add(MM.desktop, play)
      mm.add(MM.mobile, play)
      mm.add(MM.reduced, () => {
        // Fully visible static state: no marquee translation.
        gsap.set(".bay-marquee", { xPercent: 0 })
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  return (
    <section
      ref={root}
      id="impact"
      className="relative scroll-mt-24 overflow-hidden py-28 md:py-36"
      style={{ background: "#00001C" }}
    >
      {/* Faint grid texture so the section is not plain */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(234, 241, 255, 0.02) 2px, transparent 2px), linear-gradient(90deg, rgba(234, 241, 255, 0.02) 2px, transparent 2px)",
          backgroundSize: "72px 72px",
        }}
      />

      <div className="bay-reveal relative mx-auto max-w-5xl px-5 text-center md:px-10">
        <p className="mb-4 font-mono text-xs font-bold uppercase tracking-[0.3em] text-[#ff5003]">Bayanihan</p>
        <blockquote className="font-heading text-[clamp(1.75rem,4.5vw,3.5rem)] font-bold italic leading-tight">
          &ldquo;Kapag may nagsalita, may makikinig.
          <span className="text-[#ff8133]"> Kapag may humingi ng tulong, may darating.</span>&rdquo;
        </blockquote>
        <p className="mt-4 text-sm text-white/40">When someone speaks, someone listens. When someone calls for help, someone comes.</p>
      </div>

      <div className="relative mt-16 space-y-5">
        <WordMarqueeRow words={WORDS_A} />
        <WordMarqueeRow words={WORDS_B} reverse />
      </div>

      <div id="community" className="relative mx-auto mt-24 max-w-7xl scroll-mt-24 px-5 md:px-10">
        <h2 className="bay-reveal font-heading text-[clamp(1.9rem,4.5vw,3.5rem)] font-bold leading-tight">
          Built for every role in the community.
        </h2>

        <div className="mt-14 border-t border-white/10">
          {ROLES.map(([title, body], i) => {
            const reversed = i % 2 === 1
            return (
              <div
                key={title}
                className={`bay-role group relative flex flex-col items-center gap-5 border-b border-white/10 py-12 text-center md:flex-row md:items-center md:gap-12 md:py-16 md:text-left ${reversed ? "md:flex-row-reverse md:text-right" : ""}`}
              >
                {/* Accent bar grows on hover, mirrored to the row's leading edge (desktop only) */}
                <span
                  aria-hidden
                  className={`pointer-events-none absolute top-0 hidden h-full w-[2px] origin-top scale-y-0 bg-[#ff5003] transition-transform duration-500 ease-out group-hover:scale-y-100 md:block ${reversed ? "right-0" : "left-0"}`}
                />
                {/* Huge ghost index, alternating sides on md+ */}
                <span
                  aria-hidden
                  className="block shrink-0 select-none font-mono text-[clamp(5.5rem,12vw,9rem)] font-bold leading-none text-white/[0.09] md:px-8"
                  style={{ WebkitTextStroke: "1px rgba(221, 228, 242, 0.48)" }}
                >
                  0{i + 1}
                </span>
                <div>
                  <h3 className="font-heading text-3xl font-bold text-[#f5f2ec] md:text-4xl">{title}</h3>
                  <p className={`mt-3 leading-relaxed text-white/55 md:max-w-xl ${reversed ? "md:ml-auto" : ""}`}>{body}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
