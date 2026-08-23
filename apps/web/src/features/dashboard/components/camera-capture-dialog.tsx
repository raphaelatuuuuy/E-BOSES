"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CameraIcon, RefreshCcwIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

/** How long a camera may sit open without delivering a frame before we say so. */
const FIRST_FRAME_TIMEOUT_MS = 6000

/**
 * A real phone or tablet, as opposed to a laptop with a phone paired as a
 * webcam. Only here does "front or rear" describe a real choice.
 */
function isHandset(): boolean {
  const data = (navigator as Navigator & { userAgentData?: { mobile?: boolean } })
    .userAgentData
  if (typeof data?.mobile === "boolean") return data.mobile
  return window.matchMedia("(pointer: coarse)").matches
}

/**
 * Live camera capture for the report flow. A `capture="environment"` file
 * input reaches the sensor only on phone browsers — desktops ignore it and
 * open the file picker — so this dialog drives `getUserMedia` directly and
 * grabs the frame through a canvas as a JPEG File.
 *
 * Requires HTTPS (secure context), which both dev certs and prod provide.
 */
export function CameraCaptureDialog({
  open,
  onClose,
  onCapture,
}: {
  open: boolean
  onClose: () => void
  onCapture: (file: File) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const facingRef = useRef<"environment" | "user">("environment")
  /** The camera in use, so a failed retry knows what to stop asking for. */
  const deviceIdRef = useRef<string | null>(null)
  const watchdogRef = useRef<number | null>(null)

  const [busy, setBusy] = useState(false)
  /** Every video input. Labels arrive only after the first grant. */
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [activeDeviceId, setActiveDeviceId] = useState("")
  /** True once frames actually arrive, not merely once the stream opens. */
  const [ready, setReady] = useState(false)
  /** Set when a camera opened but never delivered a frame. */
  const [stalled, setStalled] = useState(false)
  /** Resolved after mount so server rendering never touches `navigator`. */
  const [handset, setHandset] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setHandset(isHandset()), 0)
    return () => window.clearTimeout(timer)
  }, [])

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
  }, [])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const startStream = useCallback(
    async (preferredDeviceId?: string) => {
      stopStream()
      clearWatchdog()
      setBusy(true)
      setReady(false)
      setStalled(false)

      // Asking for a specific camera beats asking for a facing direction, and
      // on a desktop it is the only reliable way. Only a real handset, where
      // front and rear are the actual choice, asks by facing.
      const base: MediaTrackConstraints = preferredDeviceId
        ? { deviceId: { exact: preferredDeviceId } }
        : isHandset()
          ? { facingMode: { ideal: facingRef.current } }
          : {}

      // Resolution is requested separately and dropped on retry. Virtual
      // cameras (Phone Link, OBS, DroidCam) often publish one fixed format and
      // fail the whole request rather than negotiate down from 1920x1080.
      const withResolution: MediaTrackConstraints = {
        ...base,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      }

      const attempt = (video: MediaTrackConstraints) =>
        navigator.mediaDevices.getUserMedia({ video, audio: false })

      try {
        let stream: MediaStream
        try {
          stream = await attempt(withResolution)
        } catch (reason) {
          const name = reason instanceof DOMException ? reason.name : ""
          if (name === "OverconstrainedError") {
            // Either the resolution or the device is the problem. Drop the
            // resolution first, since that keeps the chosen camera.
            try {
              stream = await attempt(base)
            } catch {
              if (!preferredDeviceId) throw reason
              deviceIdRef.current = null
              stream = await attempt({})
            }
          } else if (name === "NotFoundError" && preferredDeviceId) {
            // The remembered camera is gone — unpaired phone, unplugged webcam.
            deviceIdRef.current = null
            stream = await attempt({})
          } else {
            throw reason
          }
        }

        if (!openRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }

        // A virtual camera can open cleanly and then send nothing at all —
        // Phone Link publishes its device whether or not the handset is
        // actually streaming. Without this the dialog would sit on "Starting
        // camera…" forever with no hint that another camera would work.
        watchdogRef.current = window.setTimeout(() => {
          if (openRef.current) setStalled(true)
        }, FIRST_FRAME_TIMEOUT_MS)

        // Some browsers report no deviceId back from getSettings(); falling
        // back to what was asked for keeps the switch button stepping forward
        // instead of snapping back to the first camera.
        const inUse =
          stream.getVideoTracks()[0]?.getSettings().deviceId || preferredDeviceId || ""
        deviceIdRef.current = inUse || null
        setActiveDeviceId(inUse)

        try {
          const all = await navigator.mediaDevices.enumerateDevices()
          // Labels are blank until a grant exists, which is why this runs after
          // getUserMedia rather than before it.
          setDevices(all.filter((item) => item.kind === "videoinput"))
        } catch {
          setDevices([])
        }
      } catch (reason) {
        // Switching to a camera another app is holding must not close the
        // dialog — the previous camera worked, and shutting everything down
        // reads as "the button did nothing".
        const name = reason instanceof DOMException ? reason.name : ""
        if (preferredDeviceId && (name === "NotReadableError" || name === "AbortError")) {
          toast.error("That camera is in use by another app. Pick a different one.")
          setStalled(true)
          return
        }
        toast.error("Camera unavailable. Allow camera access or use the gallery.")
        onCloseRef.current()
      } finally {
        setBusy(false)
      }
    },
    [clearWatchdog, stopStream],
  )

  useEffect(() => {
    if (!open) return
    // Deferred one tick so startStream's setState never fires synchronously
    // inside the effect body.
    const timer = window.setTimeout(() => void startStream(), 0)
    return () => {
      window.clearTimeout(timer)
      clearWatchdog()
      stopStream()
      // Without this the next open would render the dead last frame as if it
      // were a live preview until the new stream starts producing.
      setReady(false)
      setStalled(false)
    }
  }, [open, startStream, stopStream, clearWatchdog])

  function handleFirstFrame() {
    clearWatchdog()
    setStalled(false)
    setReady(true)
  }

  /** Handsets flip front/rear; a desktop steps through its cameras instead. */
  function switchCamera() {
    if (handset) {
      facingRef.current = facingRef.current === "environment" ? "user" : "environment"
      void startStream()
      return
    }
    const index = devices.findIndex((item) => item.deviceId === activeDeviceId)
    const next = devices[(index + 1) % devices.length]
    if (next) void startStream(next.deviceId)
  }

  function captureFrame() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext("2d")?.drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        onCapture(new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" }))
        onCloseRef.current()
      },
      "image/jpeg",
      0.92,
    )
  }

  if (typeof document === "undefined" || !open) return null

  const otherCamera = devices.find((item) => item.deviceId !== activeDeviceId)
  const canSwitch = handset || devices.length > 1

  return createPortal(
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/90 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Take photo"
        className="relative w-full max-w-[440px] overflow-hidden rounded-[28px] bg-black shadow-2xl"
      >
        <div className="relative aspect-[3/4] w-full bg-neutral-900">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            onPlaying={handleFirstFrame}
            onLoadedData={handleFirstFrame}
            className="absolute left-1/2 top-1/2 h-[calc(100%_+_2px)] w-[calc(100%_+_2px)] min-h-full min-w-full -translate-x-1/2 -translate-y-1/2 object-cover"
          />

          {ready ? null : (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
              {stalled ? (
                <>
                  <p className="text-[13px] font-medium text-white">
                    This camera is not sending any video.
                  </p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
                    {activeDeviceId && /virtual|phone|link|droid|obs/i.test(
                      devices.find((item) => item.deviceId === activeDeviceId)?.label ?? "",
                    )
                      ? "It is a virtual camera, so it only sends video while its app is running and connected."
                      : "It may be switched off or in use by another app."}
                  </p>
                  {otherCamera ? (
                    <button
                      type="button"
                      onClick={() => void startStream(otherCamera.deviceId)}
                      className="mt-3 rounded-full bg-white/15 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-white/25"
                    >
                      Try {otherCamera.label || "the other camera"}
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="text-[13px] text-white/60">Starting camera…</p>
              )}
            </div>
          )}

          {/* Keeps the white shutter readable against a bright preview. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/60 to-transparent" />
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            className="flex size-14 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
            aria-label="Close camera"
          >
            <XIcon className="size-7" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={captureFrame}
            disabled={busy || !ready}
            className="flex size-[74px] items-center justify-center rounded-full border-4 border-white/90 bg-white text-neutral-900 transition-transform active:scale-95 disabled:opacity-40"
            aria-label="Shutter"
          >
            <CameraIcon className="size-7" strokeWidth={2} />
          </button>
          {canSwitch ? (
            <button
              type="button"
              onClick={switchCamera}
              disabled={busy}
              className="flex size-14 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25 disabled:opacity-40"
              aria-label="Switch camera"
              title="Switch camera"
            >
              <RefreshCcwIcon className="size-7" strokeWidth={2} />
            </button>
          ) : (
            <span className="size-14" aria-hidden />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
