"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { CameraIcon, RefreshCcwIcon, XIcon } from "lucide-react"
import { toast } from "sonner"

/**
 * Live camera capture for the report flow. A `capture="environment"` file
 * input reaches the sensor only on phone browsers — desktops ignore it and
 * open the file picker — so this dialog drives `getUserMedia` directly:
 * rear-camera preview, frame grabbed through a canvas as a JPEG File.
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
  const [busy, setBusy] = useState(false)
  const [videoCount, setVideoCount] = useState(0)

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const startStream = useCallback(async () => {
    stopStream()
    setBusy(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facingRef.current },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      if (!openRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => undefined)
      }
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        setVideoCount(devices.filter((d) => d.kind === "videoinput").length)
      } catch {
        setVideoCount(1)
      }
    } catch {
      toast.error("Camera unavailable. Allow camera access or use the gallery.")
      onCloseRef.current()
    } finally {
      setBusy(false)
    }
  }, [stopStream])

  useEffect(() => {
    if (!open) return
    // Deferred one tick so startStream's setState never fires synchronously
    // inside the effect body.
    const timer = window.setTimeout(() => void startStream(), 0)
    return () => {
      window.clearTimeout(timer)
      stopStream()
    }
  }, [open, startStream, stopStream])

  function switchCamera() {
    facingRef.current = facingRef.current === "environment" ? "user" : "environment"
    void startStream()
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

  return createPortal(
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/90 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Take photo"
        className="relative w-full max-w-[440px] overflow-hidden rounded-[28px] bg-black shadow-2xl"
      >
        <div className="relative aspect-[3/4] w-full bg-neutral-900">
          {/* Video is hidden but kept in DOM so captureFrame() can draw from it */}
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0"
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <CameraIcon className="size-16 text-white/40" strokeWidth={1.5} />
            <p className="mt-3 text-[13px] text-white/60">{busy ? "Starting camera…" : "Tap shutter to capture"}</p>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            className="flex size-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25"
            aria-label="Close camera"
          >
            <XIcon className="size-6" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={captureFrame}
            disabled={busy}
            className="size-[74px] rounded-full border-4 border-white/90 bg-white transition-transform active:scale-95 disabled:opacity-40"
            aria-label="Shutter"
          />
          {videoCount > 1 ? (
            <button
              type="button"
              onClick={switchCamera}
              disabled={busy}
              className="flex size-12 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25 disabled:opacity-40"
              aria-label="Switch camera"
            >
              <RefreshCcwIcon className="size-6" strokeWidth={2} />
            </button>
          ) : (
            <span className="size-12" aria-hidden />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
