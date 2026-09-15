import { useEffect, useRef, useState } from "react"
import { ArrowRightIcon, CheckIcon, InfoIcon, WifiOffIcon } from "lucide-react"

import { SOSButton } from "@/features/dashboard/components/sos-button"
import { refreshOfflineSosConfig } from "@/features/dashboard/components/sos/offline-sos-config"
import { useAuthSession } from "@/features/auth/auth-session"
import { probeApiReachability, useApiReachability } from "@/lib/api-reachability"

export function GlobalSosCoordinator() {
  const { refreshUser } = useAuthSession()
  const online = useApiReachability()
  const [showReconnected, setShowReconnected] = useState(false)
  const [mounted, setMounted] = useState(() => !online)
  const [hiding, setHiding] = useState(false)
  const [wasReconnected, setWasReconnected] = useState(false)
  const wasOfflineRef = useRef(!online)
  const [initialOnline] = useState(() => online)
  const [wasEverOnline, setWasEverOnline] = useState(() => online)
  if (online && !wasEverOnline) setWasEverOnline(true)
  const hideTimerRef = useRef<number | undefined>(undefined)
  const reconnectTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const shouldShow = !online || showReconnected
    if (shouldShow) {
      window.clearTimeout(hideTimerRef.current)
      queueMicrotask(() => {
        setHiding(false)
        setMounted(true)
      })
      return
    }
    queueMicrotask(() => setHiding(true))
    hideTimerRef.current = window.setTimeout(() => {
      setMounted(false)
      setHiding(false)
      setWasReconnected(false)
    }, 200)
    return () => window.clearTimeout(hideTimerRef.current)
  }, [online, showReconnected])

  useEffect(() => {
    if (online) {
      if (!wasOfflineRef.current) return
      wasOfflineRef.current = false
      void refreshOfflineSosConfig()
      void refreshUser().catch(() => {})
      window.clearTimeout(reconnectTimerRef.current)
      setShowReconnected(true)
      setWasReconnected(true)
      reconnectTimerRef.current = window.setTimeout(
        () => setShowReconnected(false),
        2800
      )
    } else {
      wasOfflineRef.current = true
      window.clearTimeout(reconnectTimerRef.current)
      queueMicrotask(() => setShowReconnected(false))
    }
    return () => window.clearTimeout(reconnectTimerRef.current)
  }, [online, refreshUser])

  useEffect(() => { void probeApiReachability() }, [])

  const reconnected = showReconnected || (hiding && wasReconnected)
  const isColdStart =
    !online && !reconnected && !initialOnline && !wasEverOnline

  return (
    <>
      <SOSButton />
      {mounted ? (
        isColdStart ? (
          <OfflineColdStartPage hiding={hiding} />
        ) : (
          <OfflineSheetContent reconnected={reconnected} hiding={hiding} />
        )
      ) : null}
    </>
  )
}

function OfflineColdStartPage({ hiding }: { hiding: boolean }) {
  return (
    <div
      role="alert"
      aria-label="Offline emergency access"
      aria-hidden={hiding ? true : undefined}
      className={`fixed inset-0 z-[1000] flex items-center justify-center bg-brand-navy px-6 py-10 text-white transition-opacity duration-200 ${hiding ? "pointer-events-none opacity-0" : "opacity-100"}`}
    >
      <div className="motion-safe:animate-in motion-safe:zoom-in-95 w-full max-w-sm text-center motion-safe:duration-200">
        <span className="mx-auto flex size-20 items-center justify-center rounded-full bg-white/10">
          <WifiOffIcon
            className="size-10 text-sos"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </span>
        <p className="mt-6 text-[28px] font-bold tracking-tight">
          You&rsquo;re Offline
        </p>
        <p className="mt-2 text-[15px] leading-6 text-white/70">
          No internet connection. You can still get help &mdash; Emergency SOS
          works offline via SMS.
        </p>
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("eboses:open-sos"))
          }
          className="mt-6 inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-full bg-sos px-4 text-[16px] font-bold text-white focus-visible:ring-2 focus-visible:ring-sos focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Open SOS
          <ArrowRightIcon
            className="size-5"
            strokeWidth={2.25}
            aria-hidden="true"
          />
        </button>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-[13px] leading-5 text-white/60">
          <InfoIcon
            className="size-3.5 shrink-0"
            strokeWidth={2}
            aria-hidden="true"
          />
          Use your phone&rsquo;s SMS app to get help.
        </p>
        <button
          type="button"
          onClick={() => void probeApiReachability()}
          className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-full border border-white/20 px-4 text-[14px] font-semibold text-white/80 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:outline-none"
        >
          Try Again
        </button>
      </div>
    </div>
  )
}

function OfflineSheetContent({
  reconnected,
  hiding,
}: {
  reconnected: boolean
  hiding: boolean
}) {
  return (
    <aside
      aria-label={reconnected ? "Back online" : "Offline emergency access"}
      aria-hidden={hiding ? true : undefined}
      className={`fixed inset-x-0 bottom-0 z-[250] mx-auto flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border-t px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-10px_36px_rgba(15,23,42,.18)] transition-all duration-200 ease-out sm:inset-x-3 sm:bottom-[max(0.75rem,env(safe-area-inset-bottom))] sm:max-w-sm sm:rounded-2xl sm:border sm:p-4 sm:shadow-[0_18px_55px_rgba(15,23,42,0.22)] ${hiding ? "pointer-events-none translate-y-2 opacity-0" : "translate-y-0 opacity-100"} ${reconnected ? "border-emerald-200 bg-white text-neutral-900" : "border-transparent bg-brand-navy text-white"}`}
    >
      <div
        aria-hidden
        className={`mx-auto mb-2 h-1 w-10 shrink-0 rounded-full ${reconnected ? "bg-neutral-200" : "bg-white/25"}`}
      />
      {reconnected ? (
        <div className="motion-safe:animate-in motion-safe:zoom-in-95 flex min-h-[200px] flex-col items-center justify-center py-1 text-center motion-safe:duration-200">
          <span className="flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200">
            <CheckIcon
              className="size-6"
              strokeWidth={2.7}
              aria-hidden="true"
            />
          </span>
          <p className="mt-3 text-[17px] font-bold tracking-tight">
            You’re back online
          </p>
          <p className="mt-1 text-[14px] leading-5 text-neutral-600">
            Connection restored. You can continue online.
          </p>
        </div>
      ) : (
        <div className="motion-safe:animate-in motion-safe:zoom-in-95 flex min-h-[200px] flex-col items-center justify-center py-1 text-center motion-safe:duration-200">
          <span className="flex items-center justify-center text-sos drop-shadow-[0_0_14px_rgba(242,59,53,0.55)]">
            <WifiOffIcon
              className="size-12"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </span>
          <p className="mt-3 text-[19px] font-bold tracking-tighter">
            You’re offline
          </p>
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("eboses:open-sos"))
            }
            className="mt-4 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-sos px-4 text-[15px] font-bold text-white focus-visible:ring-2 focus-visible:ring-sos focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Open Emergency SOS
            <ArrowRightIcon
              className="size-5"
              strokeWidth={2.25}
              aria-hidden="true"
            />
          </button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[13px] leading-5 text-white/60">
            <InfoIcon
              className="size-3.5 shrink-0"
              strokeWidth={2}
              aria-hidden="true"
            />
            Use your phone’s SMS app to get help.
          </p>
        </div>
      )}
    </aside>
  )
}
