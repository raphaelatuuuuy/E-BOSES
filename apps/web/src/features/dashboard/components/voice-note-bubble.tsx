import { useEffect, useRef, useState } from "react"
import { Loader2Icon, PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { getAccessToken } from "@/lib/api"

/**
 * Messenger-style voice note bubble.
 *
 * Audio must be fetched with the Bearer token — the raw endpoint is private
 * media, same as the image previews. The waveform is not decorative: the PCM
 * is decoded through the Web Audio API and bucketed into RMS bars, so the
 * line shape follows the actual voice. A broken fetch shows "Tap to retry"
 * instead of the current state of the world: the request is refirable.
 */
function formatVoiceTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00"
  const whole = Math.round(seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  return `${minutes}:${String(rest).padStart(2, "0")}`
}

/** Deterministic placeholder bars shown while the audio decodes. */
function placeholderBars(seed: number): number[] {
  const heights: number[] = []
  let state = (seed * 2654435761) % 4294967296
  for (let index = 0; index < 26; index += 1) {
    state = (state * 9301 + 49297) % 233280
    heights.push(5 + (state % 22))
  }
  return heights
}

/** RMS loudness per bucket over the whole clip — the real waveform. */
function waveformBars(decoded: AudioBuffer): number[] {
  const data = decoded.getChannelData(0)
  const barCount = 26
  const rms: number[] = []
  for (let bucket = 0; bucket < barCount; bucket += 1) {
    const start = Math.floor((bucket / barCount) * data.length)
    const end = Math.max(start + 1, Math.floor(((bucket + 1) / barCount) * data.length))
    let sumSquares = 0
    let count = 0
    for (let index = start; index < end; index += 1) {
      sumSquares += data[index] * data[index]
      count += 1
    }
    rms.push(Math.sqrt(sumSquares / Math.max(1, count)))
  }
  const peak = Math.max(1e-6, ...rms)
  return rms.map((value) => Math.max(4, Math.min(26, Math.round((value / peak) * 26))))
}

export function VoiceNoteBubble({
  url,
  filename,
  isDark,
  mine = false,
  flat = false,
  className,
}: {
  url: string
  filename: string
  isDark?: boolean
  mine?: boolean
  flat?: boolean
  className?: string
}) {
  const [bars, setBars] = useState<number[]>(() => placeholderBars(url.length + filename.length))
  const [attempt, setAttempt] = useState(0)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const durationRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    let created: string | null = null
    let audio: HTMLAudioElement | null = null
    let context: AudioContext | null = null
    let decodedDuration = 0

    function syncDuration(value: number) {
      if (!Number.isFinite(value) || value <= 0 || value === durationRef.current) return
      durationRef.current = value
      setDuration(value)
    }

    async function load() {
      try {
        const token = getAccessToken()
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        if (!response.ok) throw new Error(`Voice note fetch failed (${response.status})`)
        const blob = await response.blob()
        if (cancelled) return

        // Real waveform: decode the container and measure per-bucket RMS.
        // The decoded buffer also carries an exact duration, which is used as
        // a fallback when the <audio> element never reports its metadata.
        try {
          const ContextCtor =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          if (ContextCtor) {
            context = new ContextCtor()
            const decoded = await context.decodeAudioData(await blob.arrayBuffer())
            if (!cancelled) {
              setBars(waveformBars(decoded))
              decodedDuration = decoded.duration
            }
          }
        } catch {
          // Codec the browser cannot decode — the placeholder line still
          // renders and playback is untouched.
        }
        if (decodedDuration > 0) syncDuration(decodedDuration)
        if (cancelled) return

        created = URL.createObjectURL(blob)
        audio = new Audio(created)
        audio.addEventListener("loadedmetadata", () => syncDuration(audio?.duration ?? 0))
        audio.addEventListener("durationchange", () => syncDuration(audio?.duration ?? 0))
        audio.addEventListener("canplay", () => syncDuration(audio?.duration ?? 0))
        audio.addEventListener("timeupdate", () => {
          if (cancelled) return
          setCurrentTime(audio?.currentTime ?? 0)
          syncDuration(audio?.duration ?? 0)
          if (decodedDuration > 0) syncDuration(decodedDuration)
        })
        audio.addEventListener("ended", () => setPlaying(false))
        audioRef.current = audio
        setReady(true)
      } catch {
        if (!cancelled) setLoadError(true)
      }
    }

    void load()
    return () => {
      cancelled = true
      audio?.pause()
      if (created) URL.revokeObjectURL(created)
      audioRef.current = null
      void context?.close().catch(() => {})
    }
  }, [attempt, url])

  function togglePlayback() {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
      return
    }
    void audio
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false))
  }

  function retry() {
    setLoadError(false)
    durationRef.current = 0
    setAttempt((current) => current + 1)
  }

  function handleClick() {
    if (loadError) {
      retry()
      return
    }
    togglePlayback()
  }

  const buffering = !ready && !loadError
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={buffering}
      aria-label={loadError ? "Retry voice note" : playing ? "Pause voice note" : "Play voice note"}
      className={cn(
        "flex w-56 items-center gap-2.5 rounded-2xl py-1.5 pl-1.5 pr-3 text-left sm:w-64",
        flat
          ? ""
          : mine
            ? "bg-brand-orange text-white hover:bg-brand-orange-strong"
            : isDark
              ? "bg-white/10 text-white hover:bg-white/15"
              : "bg-slate-100 text-slate-800 hover:bg-slate-200",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full",
          mine && !flat ? "bg-white text-brand-orange" : "bg-brand-orange text-white",
        )}
      >
        {buffering ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : loadError ? (
          <RotateCcwIcon className="size-4" />
        ) : playing ? (
          <PauseIcon className="size-4 fill-current" />
        ) : (
          <PlayIcon className="size-4 fill-current pl-0.5" />
        )}
      </span>

      <span className="relative h-9 min-w-0 flex-1">
        <span
          className="absolute inset-0 flex items-center justify-between gap-1 overflow-hidden px-0.5"
          aria-hidden
        >
          {bars.map((height, index) => {
            const played = (index + 0.5) / bars.length <= progress
            return (
              <span
                key={index}
                className={cn(
                  "min-w-[2px] max-w-[3px] flex-1 shrink-0 rounded-full",
                  played
                    ? mine && !flat
                      ? "bg-white"
                      : "bg-brand-orange"
                    : "bg-current opacity-40",
                )}
                style={{ height }}
              />
            )
          })}
        </span>
      </span>

      <span className="shrink-0 font-semibold tabular-nums opacity-75 text-[10.5px]">
        {loadError
          ? "Tap to retry"
          : formatVoiceTime(Math.max(0, duration - currentTime))}
      </span>
    </button>
  )
}