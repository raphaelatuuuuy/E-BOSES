import { useEffect, useRef, useState } from "react"
import { CheckIcon, WifiOffIcon } from "lucide-react"

import { SOSButton } from "@/features/dashboard/components/sos-button"
import { refreshOfflineSosConfig } from "@/features/dashboard/components/sos/offline-sos-config"
import { useAuthSession } from "@/features/auth/auth-session"

export function GlobalSosCoordinator() {
  const { refreshUser } = useAuthSession()
  const [online, setOnline] = useState(() => navigator.onLine)
  const [showReconnected, setShowReconnected] = useState(false)
  const [mounted, setMounted] = useState(() => !navigator.onLine)
  const [hiding, setHiding] = useState(false)
  const wasOfflineRef = useRef(!navigator.onLine)
  const wasReconnectedRef = useRef(false)
  const hideTimerRef = useRef<number | undefined>(undefined)
  const reconnectTimerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (showReconnected) wasReconnectedRef.current = true
    const shouldShow = !online || showReconnected
    if (shouldShow) {
      window.clearTimeout(hideTimerRef.current)
      setHiding(false)
      setMounted(true)
      return
    }
    setHiding(true)
    hideTimerRef.current = window.setTimeout(() => {
      setMounted(false)
      setHiding(false)
      wasReconnectedRef.current = false
    }, 200)
    return () => window.clearTimeout(hideTimerRef.current)
  }, [online, showReconnected])

  useEffect(() => {
    const handleOnline = () => {
      if (!wasOfflineRef.current) return
      wasOfflineRef.current = false
      setOnline(true)
      void refreshOfflineSosConfig()
      void refreshUser().catch(() => {})
      window.clearTimeout(reconnectTimerRef.current)
      setShowReconnected(true)
      reconnectTimerRef.current = window.setTimeout(() => setShowReconnected(false), 2800)
    }
    const handleOffline = () => {
      wasOfflineRef.current = true
      window.clearTimeout(reconnectTimerRef.current)
      setShowReconnected(false)
      setOnline(false)
    }
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    if (navigator.onLine) void refreshOfflineSosConfig()
    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      window.clearTimeout(hideTimerRef.current)
      window.clearTimeout(reconnectTimerRef.current)
    }
  }, [refreshUser])

  return (
    <>
      <SOSButton />
      {mounted ? (
        <aside
          aria-label={showReconnected || (hiding && wasReconnectedRef.current) ? "Back online" : "Offline emergency access"}
          aria-hidden={hiding ? true : undefined}
          className={`fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[250] mx-auto max-w-sm rounded-2xl border bg-white p-4 text-neutral-900 shadow-[0_18px_55px_rgba(15,23,42,0.22)] transition-all duration-200 ease-out ${hiding ? "translate-y-2 opacity-0 pointer-events-none" : "translate-y-0 opacity-100"} ${showReconnected || (hiding && wasReconnectedRef.current) ? "border-emerald-200" : "border-neutral-200"}`}
        >
          {showReconnected || (hiding && wasReconnectedRef.current) ? (
            <div className="flex flex-col items-center py-1 text-center motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:duration-200">
              <span className="flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200">
                <CheckIcon className="size-6" strokeWidth={2.7} aria-hidden="true" />
              </span>
              <p className="mt-3 text-[17px] font-bold tracking-tight">You’re back online</p>
              <p className="mt-1 text-[14px] leading-5 text-neutral-600">Connection restored. You can continue online.</p>
            </div>
          ) : (
            <>
              <p className="flex items-center gap-2 text-[11px] font-extrabold tracking-[0.12em] text-sos">
                <WifiOffIcon className="size-4" aria-hidden="true" /> OFFLINE
              </p>
              <p className="mt-3 text-[17px] font-bold">You’re offline</p>
              <p className="mt-1 text-[14px] leading-5 text-neutral-600">You can still request emergency help using your phone’s SMS app.</p>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("eboses:open-sos"))}
                className="mt-4 min-h-[52px] w-full rounded-full bg-sos px-4 text-[15px] font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sos focus-visible:ring-offset-2"
              >
                Open Emergency SOS
              </button>
            </>
          )}
        </aside>
      ) : null}
    </>
  )
}
