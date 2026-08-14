import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

function audioExtensionFor(mime: string) {
  if (mime.includes("mp4")) return "m4a"
  if (mime.includes("ogg")) return "ogg"
  if (mime.includes("mpeg")) return "mp3"
  return "webm"
}

/** "0:07" / "1:24" style clock for a recording or a ready voice note. */
export function formatVoiceTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/**
 * Shared voice-note recorder used by every chat composer in the app.
 *
 * `startRecording` asks the browser for the microphone, streams chunks into
 * a MediaRecorder (WebM/Opus, MP4 or OGG whichever the browser can do) and
 * pushes live volume levels for the waveform while `recording` is true.
 *
 * `stopRecording` finalizes the clip into `readyFile` — it does NOT send it
 * anywhere; the caller shows the preview with explicit send/cancel actions.
 * `cancelRecording` drops an in-progress take; `discardRecording` clears a
 * finalized preview.
 */
export function useVoiceRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const timerRef = useRef<number | null>(null)
  const meterRef = useRef<number | null>(null)
  const discardRef = useRef(false)
  const secondsRef = useRef(0)
  const smoothLevelRef = useRef(0)
  const peakLevelRef = useRef(0)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [levels, setLevels] = useState<number[]>([])
  const [readyFile, setReadyFile] = useState<File | null>(null)
  const [durationSeconds, setDurationSeconds] = useState(0)

  const stopTicker = useCallback(() => {
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = null
    if (meterRef.current) window.clearInterval(meterRef.current)
    meterRef.current = null
  }, [])

  const teardown = useCallback(() => {
    stopTicker()
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    analyserRef.current = null
    if (contextRef.current) void contextRef.current.close().catch(() => {})
    contextRef.current = null
    setRecording(false)
    setRecordSeconds(0)
  }, [stopTicker])

  function readLevel(): number {
    const analyser = analyserRef.current
    if (!analyser) return 0
    const data = new Uint8Array(analyser.fftSize)
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let index = 0; index < data.length; index += 1) {
      const sample = (data[index] - 128) / 128
      sum += sample * sample
    }
    const rms = Math.sqrt(sum / Math.max(1, data.length))
    peakLevelRef.current = Math.max(rms, peakLevelRef.current * 0.97)
    const peak = peakLevelRef.current
    const target = peak > 0.0001 ? Math.min(1, Math.sqrt(rms / peak) * 1.15) : 0.12
    smoothLevelRef.current += (target - smoothLevelRef.current) * 0.5
    return Math.max(0.04, Math.min(1, smoothLevelRef.current))
  }

  const startRecording = useCallback(async () => {
    if (recorderRef.current) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
    } catch {
      toast.error("Could not access the microphone. Check the browser permission and try again.")
      return
    }
    const preferred = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg"]
    const mime = preferred.find((candidate) => MediaRecorder.isTypeSupported(candidate))
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    chunksRef.current = []
    discardRef.current = false
    secondsRef.current = 0
    recorderRef.current = recorder
    streamRef.current = stream
    try {
      const AudioContextCtor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (AudioContextCtor) {
        const context = new AudioContextCtor()
        const analyser = context.createAnalyser()
        analyser.fftSize = 256
        const source = context.createMediaStreamSource(stream)
        source.connect(analyser)
        contextRef.current = context
        analyserRef.current = analyser
      }
    } catch {
      /* Metering unavailable; the recording itself still works. */
    }
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onstop = () => {
      const mimeType = recorder.mimeType || "audio/webm"
      const chunks = chunksRef.current
      const cancelled = discardRef.current
      chunksRef.current = []
      teardown()
      if (cancelled) return
      const blob = new Blob(chunks, { type: mimeType })
      if (blob.size === 0) {
        toast.error("The recording came back empty. Try again.")
        return
      }
      setReadyFile(
        new File(
          [blob],
          `voice-note-${Date.now()}.${audioExtensionFor(mimeType)}`,
          { type: mimeType },
        ),
      )
      setDurationSeconds(secondsRef.current)
    }
    recorder.start(250)
    setLevels([])
    setReadyFile(null)
    setDurationSeconds(0)
    setRecording(true)
    smoothLevelRef.current = 0
    peakLevelRef.current = 0
    timerRef.current = window.setInterval(() => {
      secondsRef.current += 1
      setRecordSeconds(secondsRef.current)
    }, 1000)
    meterRef.current = window.setInterval(() => {
      setLevels((current) => {
        const next = [...current, readLevel()]
        return next.length > 30 ? next.slice(next.length - 30) : next
      })
    }, 120)
  }, [teardown])

  /** Finalize the take into `readyFile` — the caller sends explicitly. */
  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") {
      recorder.stop()
    } else if (!recorder) {
      discardRef.current = true
      teardown()
    }
  }, [teardown])

  /** Drop the in-progress take without producing a file. */
  const cancelRecording = useCallback(() => {
    discardRef.current = true
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") {
      recorder.stop()
    } else {
      teardown()
    }
  }, [teardown])

  /** Clear a finalized preview without sending. */
  const discardRecording = useCallback(() => {
    setReadyFile(null)
    setDurationSeconds(0)
  }, [])

  useEffect(() => {
    return () => {
      discardRef.current = true
      const recorder = recorderRef.current
      if (recorder && recorder.state !== "inactive") recorder.stop()
      teardown()
    }
  }, [teardown])

  return {
    recording,
    recordSeconds,
    levels,
    readyFile,
    durationSeconds,
    startRecording,
    stopRecording,
    cancelRecording,
    discardRecording,
  }
}