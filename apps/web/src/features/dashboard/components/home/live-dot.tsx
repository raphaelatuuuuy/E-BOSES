import { Link } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"

export function LiveDot({
  src,
  alert,
  label,
  to,
  title,
}: {
  src: string
  alert: boolean
  label: string
  to?: string
  title?: string
}) {
  const dot = (
    <>
      <span className="rail-live-dot__map">
        <img src={src} alt="" loading="lazy" decoding="async" />
      </span>
      <span className="rail-live-dot__status-wrap">
        <span
          className={cn(
            "rail-live-dot__ring",
            alert && "rail-live-dot__ring--alert"
          )}
          aria-hidden
        />
        <span
          className={cn(
            "rail-live-dot__ring rail-live-dot__ring--delay",
            alert && "rail-live-dot__ring--alert"
          )}
          aria-hidden
        />
        <span
          className={cn(
            "rail-live-dot__status",
            alert && "rail-live-dot__status--alert"
          )}
          aria-hidden
        />
      </span>
    </>
  )
  return (
    <>
      <style>{`
        .rail-live-dot {
          position: relative;
          display: inline-flex;
          width: 40px;
          height: 40px;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
        }
        .rail-live-dot__map {
          position: relative;
          z-index: 1;
          width: 40px;
          height: 40px;
          overflow: hidden;
          border-radius: 9999px;
          background: #e8eef5;
        }
        .rail-live-dot__map img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .rail-live-dot__status-wrap {
          position: absolute;
          left: 50%;
          top: 50%;
          z-index: 2;
          width: 12px;
          height: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          transform: translate(-50%, -50%);
        }
        .rail-live-dot__status {
          position: relative;
          z-index: 2;
          width: 10px;
          height: 10px;
          border-radius: 9999px;
          background: var(--color-brand-navy);
          border: 1.5px solid #fff;
          box-shadow: 0 0 0 1px rgb(7 20 95 / 0.25);
        }
        .rail-live-dot__status--alert {
          background: var(--color-sos);
          box-shadow: 0 0 0 1px rgb(242 59 53 / 0.35);
        }
        .rail-live-dot__ring {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 10px;
          height: 10px;
          margin-left: -5px;
          margin-top: -5px;
          border-radius: 9999px;
          border: 1.5px solid rgba(34, 197, 94, 0.55);
          animation: rail-live-scan 3.8s cubic-bezier(0.22, 1, 0.36, 1) infinite;
          pointer-events: none;
        }
        .rail-live-dot__ring--alert {
          border-color: rgba(239, 68, 68, 0.6);
        }
        .rail-live-dot__ring--delay {
          animation-delay: 1.9s;
        }
        @keyframes rail-live-scan {
          0% {
            transform: scale(1);
            opacity: 0.65;
          }
          70% {
            transform: scale(2.6);
            opacity: 0;
          }
          100% {
            transform: scale(2.6);
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .rail-live-dot__ring { animation: none; opacity: 0.3; transform: scale(1.4); }
        }
      `}</style>
      {to ? (
        <Link
          to={to}
          className="rail-live-dot shrink-0 no-underline"
          aria-label={label}
          title={title ?? "Open alerts map"}
        >
          {dot}
        </Link>
      ) : (
        <span className="rail-live-dot" title={title} aria-hidden>
          {dot}
        </span>
      )}
    </>
  )
}

export function liveDotAriaLabel(
  communityName: string,
  alert: boolean,
  alertCount: number
) {
  return alert
    ? `Live map — ${alertCount} ongoing alert${alertCount === 1 ? "" : "s"}`
    : `Live map — ${communityName}`
}
