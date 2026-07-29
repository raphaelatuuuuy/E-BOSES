// apps/web/src/features/landing/scenes/problem-logbook.tsx
// Decorative line-art records folder: a manila-folder silhouette (back panel
// with a tab, plus a front pocket drawn over the slips) so the paper slips
// read as tucked inside. Purely presentational; problem.tsx drives the GSAP
// animation via the .logbook-stroke / .logbook-caption / .problem-slip /
// .problem-slip-drift hooks.

const BARCODE_XS = [296, 301, 306, 313, 318, 326, 331]

const GLOW = { filter: "drop-shadow(0 0 14px rgba(255,80,3,0.12))" }

export function ProblemLogbook() {
  return (
    <div
      aria-hidden
      className="problem-logbook relative mx-auto w-full max-w-[300px] md:max-w-[420px]"
    >
      <div className="problem-logbook-inner relative">
        {/* Folder back panel with tab (behind the slips) */}
        <svg viewBox="0 0 360 264" className="block h-auto w-full" style={GLOW} fill="none">
          {/* Corner brackets */}
          <path className="logbook-stroke" d="M2 18V2H18" stroke="#ff5003" strokeOpacity={0.8} />
          <path className="logbook-stroke" d="M342 2H358V18" stroke="#ff5003" strokeOpacity={0.8} />
          <path className="logbook-stroke" d="M358 246V262H342" stroke="#ff5003" strokeOpacity={0.8} />
          <path className="logbook-stroke" d="M18 262H2V246" stroke="#ff5003" strokeOpacity={0.8} />

          {/* Back panel outline with raised folder tab */}
          <path
            className="logbook-stroke"
            d="M26 246V60H40L48 34H182L190 60H334V246H26Z"
            fill="rgba(255,255,255,0.03)"
            stroke="rgba(255,255,255,0.22)"
          />

          {/* Tab base seam */}
          <line className="logbook-stroke" x1={40} y1={60} x2={190} y2={60} stroke="rgba(255,255,255,0.12)" />

          {/* Caption on the folder tab */}
          <text
            className="logbook-caption font-mono"
            x={60}
            y={51}
            fontSize={11}
            letterSpacing="0.25em"
            fill="rgba(245,242,236,0.75)"
          >
            LOGBOOK 2026
          </text>

          {/* Barcode detail, top right of the back panel */}
          {BARCODE_XS.map((x, i) => (
            <line
              key={x}
              className="logbook-stroke"
              x1={x}
              y1={68}
              x2={x}
              y2={84}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={i % 3 === 0 ? 2 : 1}
            />
          ))}
        </svg>

        {/* Paper slips tucked into the folder (bottoms hidden by the pocket) */}
        <div className="problem-slip-drift absolute left-[9%] top-[32%] w-[38%]">
          <div className="problem-slip -rotate-6 border border-white/20 bg-[#0b0b10]/95 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.55)]">
            <div className="h-px w-3/4 bg-white/25" />
            <div className="mt-2 h-px w-full bg-white/15" />
            <div className="mt-2 h-px w-1/2 bg-white/15" />
          </div>
        </div>

        <div className="problem-slip-drift absolute right-[6%] top-[24%] w-[50%]">
          <div className="problem-slip rotate-2 border border-[#ff8133]/35 bg-[#0b0b10]/95 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.55),0_0_18px_rgba(255,80,3,0.1)]">
            <div className="flex items-center justify-between gap-2">
              <div className="h-px w-1/4 bg-white/25" />
              <span className="whitespace-nowrap border border-[#ff5003]/50 bg-[#ff5003]/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.2em] text-[#ff8133]">
                walang update
              </span>
            </div>
            <div className="mt-2.5 h-px w-full bg-white/15" />
            <div className="mt-2 h-px w-2/3 bg-white/15" />
          </div>
        </div>

        <div className="problem-slip-drift absolute left-[30%] top-[36%] w-[42%]">
          <div className="problem-slip -rotate-2 border border-white/20 bg-[#0b0b10]/95 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.55)]">
            <div className="h-px w-2/3 bg-white/25" />
            <div className="mt-2 h-px w-11/12 bg-white/15" />
          </div>
        </div>

        {/* Folder front pocket (in front of the slips) */}
        <svg
          viewBox="0 0 360 264"
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={GLOW}
          fill="none"
        >
          <path
            className="logbook-stroke"
            d="M18 110L342 104V252H18Z"
            fill="#0c0c11"
            stroke="rgba(255,255,255,0.26)"
          />
          {/* Accent seam along the pocket edge */}
          <line className="logbook-stroke" x1={18} y1={118} x2={342} y2={112} stroke="#ff5003" strokeOpacity={0.5} />
          {/* Folded corner, bottom right */}
          <path className="logbook-stroke" d="M342 216L312 252" stroke="#ff8133" strokeOpacity={0.5} />
          {/* Blank routing label on the pocket */}
          <rect className="logbook-stroke" x={36} y={196} width={118} height={30} stroke="rgba(255,255,255,0.16)" />
          <line className="logbook-stroke" x1={46} y1={208} x2={140} y2={208} stroke="rgba(255,255,255,0.14)" />
          <line className="logbook-stroke" x1={46} y1={216} x2={122} y2={216} stroke="rgba(255,255,255,0.14)" />
        </svg>
      </div>
    </div>
  )
}
