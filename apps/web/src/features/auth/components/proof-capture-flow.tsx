"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
  ApertureIcon,
  ArrowLeftIcon,
  CameraIcon,
  CheckCircle2Icon,
  CropIcon,
  FocusIcon,
  HelpCircleIcon,
  ImageIcon,
  InfoIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  ScanIcon,
  SunIcon,
  XCircleIcon,
  XIcon,
  ZapIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { BoxIdCardIcon } from "@/features/auth/components/id-card-icon"
import {
  checkRegistrationProof,
  detectRegistrationProof,
  type ResidenceProofDetectResult,
} from "@/features/auth/api"
import { getProofOfResidencyFileError } from "@/features/auth/schemas/sign-up-schema"
import {
  DocumentQualityAnalyzer,
  emptyQualityResult,
  type DocumentQualityResult,
  type QualityStatus,
} from "@/features/auth/lib/document-quality"
import { prepareProofImage } from "@/features/auth/lib/prepare-proof-image"
import type { ProofSide, ResidenceProofOption } from "@/features/ocr/api"
import { ApiError, apiBaseUrl, networkErrorMessage } from "@/lib/api"

type Step = "types" | "guide" | "capture" | "processing" | "success" | "error"

export interface ProofCaptureResult {
  proofType: string
  files: File[]
  sides: ProofSide[]
  detect: ResidenceProofDetectResult | null
}

interface ProofCaptureFlowProps {
  open: boolean
  onClose: () => void
  onComplete: (result: ProofCaptureResult) => void
  proofOptions: ResidenceProofOption[]
  loadingOptions?: boolean
  existingFiles?: File[]
}

async function fileDigest(file: File) {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest("SHA-256", buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

/** Ordered list of sides the user must capture for this document type. */
function sidesForOption(option: ResidenceProofOption | null): ProofSide[] {
  if (!option) return ["single"]
  const sides = option.required_sides?.length ? option.required_sides : ["single"]
  const needsFrontBack = sides.includes("front") && sides.includes("back")
  if (needsFrontBack || ((option.max_files ?? 1) >= 2 && sides.includes("back"))) {
    return ["front", "back"]
  }
  if (sides.includes("front") && !sides.includes("back") && !sides.includes("single")) {
    return ["front"]
  }
  if (sides.includes("single") || sides.length === 0) {
    return ["single"]
  }
  const ordered: ProofSide[] = []
  for (const side of ["front", "back", "single"] as ProofSide[]) {
    if (sides.includes(side)) ordered.push(side)
  }
  return ordered.length ? ordered : ["single"]
}

function sideLabel(side: ProofSide): string {
  if (side === "front") return "Front side"
  if (side === "back") return "Back side"
  return "Document"
}

function sideCaptureLabel(side: ProofSide): string {
  if (side === "front") return "Capture Front of ID"
  if (side === "back") return "Capture Back of ID"
  return "Capture Document"
}

type ExtractedFieldRow = {
  key: string
  label: string
  value: string
  confidence: number | null
}

/** Flatten detect API extracted_fields into rows + simple JSON { key: value }. */
function flattenExtractedFields(
  raw: ResidenceProofDetectResult["extracted_fields"] | Record<string, unknown> | null | undefined,
): { rows: ExtractedFieldRow[]; json: Record<string, string> } {
  const rows: ExtractedFieldRow[] = []
  const json: Record<string, string> = {}
  if (!raw || typeof raw !== "object") return { rows, json }

  for (const [key, item] of Object.entries(raw)) {
    if (!key || key.startsWith("__")) continue
    let value = ""
    let label = key
    let confidence: number | null = null

    if (item == null) {
      value = ""
    } else if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      value = String(item).trim()
    } else if (typeof item === "object") {
      const obj = item as Record<string, unknown>
      value = String(obj.value ?? obj.normalized ?? obj.text ?? "").trim()
      label = String(obj.label || key)
      if (typeof obj.confidence === "number") confidence = obj.confidence
    }

    rows.push({ key, label, value, confidence })
    if (value) json[key] = value
  }

  // Prefer stable order: common ID fields first, then rest alphabetically
  const priority = [
    "full_name",
    "first_name",
    "middle_name",
    "last_name",
    "date_of_birth",
    "place_of_birth",
    "address",
    "gender",
    "civil_status",
    "document_number",
    "issue_date",
    "expiry_date",
  ]
  rows.sort((a, b) => {
    const ai = priority.indexOf(a.key)
    const bi = priority.indexOf(b.key)
    if (ai === -1 && bi === -1) return a.key.localeCompare(b.key)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  return { rows, json }
}

const EMPTY_QUALITY = emptyQualityResult("Searching")

function StatusIcon({ status }: { status: QualityStatus }) {
  if (status === "pass") {
    return <CheckCircle2Icon className="size-4 shrink-0 text-emerald-400" />
  }
  if (status === "warn") {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-black">
        !
      </span>
    )
  }
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
      !
    </span>
  )
}

function QualityBar({
  score,
  status,
}: {
  score: number
  status: QualityStatus
}) {
  const color =
    status === "pass" ? "bg-emerald-400" : status === "warn" ? "bg-amber-400" : "bg-red-500"
  return (
    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/20">
      <div className={cn("h-full rounded-full transition-all duration-300", color)} style={{ width: `${clamp(score)}%` }} />
    </div>
  )
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, n))
}

function CheckRow({
  icon,
  label,
  status,
  score,
  showBar,
}: {
  icon: React.ReactNode
  label: string
  status: QualityStatus
  score?: number
  showBar?: boolean
}) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-white/95">
      <span className="text-white/70">{icon}</span>
      <span className="min-w-0 flex-1 font-medium">{label}</span>
      {showBar && score != null ? <QualityBar score={score} status={status} /> : null}
      <StatusIcon status={status} />
    </div>
  )
}

export function ProofCaptureFlow({
  open,
  onClose,
  onComplete,
  proofOptions,
  loadingOptions,
  existingFiles = [],
}: ProofCaptureFlowProps) {
  const [step, setStep] = React.useState<Step>("types")
  const [selectedType, setSelectedType] = React.useState<ResidenceProofOption | null>(null)
  const [autoCapture, setAutoCapture] = React.useState(true)
  const [cameraError, setCameraError] = React.useState<string | null>(null)
  const [streamReady, setStreamReady] = React.useState(false)
  const [detect, setDetect] = React.useState<ResidenceProofDetectResult | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const [capturedFiles, setCapturedFiles] = React.useState<File[]>([])
  const [capturedSides, setCapturedSides] = React.useState<ProofSide[]>([])
  const [sideIndex, setSideIndex] = React.useState(0)
  const [busy, setBusy] = React.useState(false)
  const [awaitingNextSide, setAwaitingNextSide] = React.useState(false)
  const [quality, setQuality] = React.useState<DocumentQualityResult>(EMPTY_QUALITY)
  const [countdown, setCountdown] = React.useState<number | null>(null)
  const [qualityPanelOpen, setQualityPanelOpen] = React.useState(true)
  const [torchOn, setTorchOn] = React.useState(false)
  const [helpOpen, setHelpOpen] = React.useState(false)
  const [useLiveCamera, setUseLiveCamera] = React.useState(true)
  const [processingStatus, setProcessingStatus] = React.useState("Working…")
  const [statusBanner, setStatusBanner] = React.useState<string | null>(null)
  const [extractionView, setExtractionView] = React.useState<"table" | "json">("table")
  const [jsonCopied, setJsonCopied] = React.useState(false)

  const videoRef = React.useRef<HTMLVideoElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const galleryRef = React.useRef<HTMLInputElement>(null)
  const mobileCameraRef = React.useRef<HTMLInputElement>(null)
  const analyzeRafRef = React.useRef<number | null>(null)
  const readyStreakRef = React.useRef(0)
  const capturingRef = React.useRef(false)
  const countdownTimerRef = React.useRef<number | null>(null)
  const countdownActiveRef = React.useRef(false)
  const autoCaptureRef = React.useRef(autoCapture)
  autoCaptureRef.current = autoCapture
  const qualityAnalyzerRef = React.useRef<DocumentQualityAnalyzer | null>(null)
  if (!qualityAnalyzerRef.current && typeof window !== "undefined") {
    qualityAnalyzerRef.current = new DocumentQualityAnalyzer()
  }

  const requiredSides = sidesForOption(selectedType)
  const currentSide = requiredSides[sideIndex] ?? "single"
  const totalSides = requiredSides.length
  const isMultiSide = totalSides > 1

  const stopCamera = React.useCallback(() => {
    if (analyzeRafRef.current) {
      window.cancelAnimationFrame(analyzeRafRef.current)
      analyzeRafRef.current = null
    }
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStreamReady(false)
    setTorchOn(false)
    countdownActiveRef.current = false
    setCountdown(null)
    readyStreakRef.current = 0
    capturingRef.current = false
    qualityAnalyzerRef.current?.reset()
    setQuality(emptyQualityResult("Camera stopped"))
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const resetFlow = React.useCallback(() => {
    stopCamera()
    setStep("types")
    setSelectedType(null)
    setCameraError(null)
    setDetect(null)
    setErrorMessage(null)
    setCapturedFiles([])
    setCapturedSides([])
    setSideIndex(0)
    setAwaitingNextSide(false)
    setBusy(false)
    setQuality(EMPTY_QUALITY)
    setHelpOpen(false)
    setQualityPanelOpen(true)
    setProcessingStatus("Working…")
    setStatusBanner(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
  }, [previewUrl, stopCamera])

  React.useEffect(() => {
    if (!open) resetFlow()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    return () => stopCamera()
  }, [stopCamera])

  async function startCamera() {
    setCameraError(null)
    setStreamReady(false)
    stopCamera()
    qualityAnalyzerRef.current?.reset()
    setQuality(emptyQualityResult("Starting camera…"))
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("getUserMedia unavailable")
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      streamRef.current = stream
      setUseLiveCamera(true)
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        // iOS / some browsers need playsInline + muted before play
        videoRef.current.setAttribute("playsinline", "true")
        videoRef.current.muted = true
        await videoRef.current.play()
        // Wait until real frame dimensions exist before analysis
        await waitForVideoDimensions(videoRef.current)
        setStreamReady(true)
        setQuality(emptyQualityResult("Analyzing live video…"))
      }
    } catch {
      setUseLiveCamera(false)
      setStreamReady(false)
      setCameraError(
        "Camera access was denied or is unavailable. Use Upload from Gallery, or allow camera permission and try again.",
      )
      setQuality(emptyQualityResult("Camera unavailable"))
    }
  }

  function waitForVideoDimensions(video: HTMLVideoElement, timeoutMs = 4000) {
    return new Promise<void>((resolve) => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        resolve()
        return
      }
      const start = performance.now()
      const tick = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          resolve()
          return
        }
        if (performance.now() - start > timeoutMs) {
          resolve()
          return
        }
        requestAnimationFrame(tick)
      }
      video.addEventListener("loadeddata", () => resolve(), { once: true })
      requestAnimationFrame(tick)
    })
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()?.[0]
    if (!track) return
    const capabilities = track.getCapabilities?.() as { torch?: boolean } | undefined
    if (!capabilities?.torch) {
      setCameraError("Flash is not available on this camera.")
      return
    }
    try {
      const next = !torchOn
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch {
      setCameraError("Could not toggle flash on this device.")
    }
  }

  React.useEffect(() => {
    if (!open || step !== "capture" || !selectedType) return
    void startCamera()
    return () => stopCamera()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, selectedType?.key, sideIndex])

  function cancelCountdown() {
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    countdownActiveRef.current = false
    setCountdown(null)
    readyStreakRef.current = 0
  }

  function startCountdown() {
    if (capturingRef.current || countdownActiveRef.current) return
    countdownActiveRef.current = true
    setCountdown(3)
    if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current)
    countdownTimerRef.current = window.setInterval(() => {
      setCountdown((current) => {
        if (current == null) return null
        if (current <= 1) {
          if (countdownTimerRef.current) {
            window.clearInterval(countdownTimerRef.current)
            countdownTimerRef.current = null
          }
          countdownActiveRef.current = false
          void snapFromVideo()
          return null
        }
        return current - 1
      })
    }, 900)
  }

  // Live quality analysis loop
  React.useEffect(() => {
    if (!open || step !== "capture" || !streamReady) return

    let alive = true
    let lastTs = 0

    const analyzer = qualityAnalyzerRef.current ?? new DocumentQualityAnalyzer()
    qualityAnalyzerRef.current = analyzer
    analyzer.reset()

    const tick = (ts: number) => {
      if (!alive) return
      // ~10 fps live analysis
      if (ts - lastTs >= 100) {
        lastTs = ts
        const video = videoRef.current
        if (
          video &&
          video.readyState >= 2 &&
          video.videoWidth > 0 &&
          !capturingRef.current
        ) {
          try {
            const result = analyzer.analyze(video)
            setQuality(result)

            if (autoCaptureRef.current && result.readyForCapture) {
              readyStreakRef.current += 1
            } else {
              readyStreakRef.current = 0
              if (countdownActiveRef.current && !capturingRef.current) {
                cancelCountdown()
              }
            }

            // Need ~0.8s of stable "real ready" before countdown
            if (
              autoCaptureRef.current &&
              result.readyForCapture &&
              readyStreakRef.current >= 8 &&
              !countdownActiveRef.current &&
              !capturingRef.current
            ) {
              startCountdown()
            }
          } catch {
            setQuality(emptyQualityResult("Analysis error — try again"))
          }
        }
      }
      analyzeRafRef.current = window.requestAnimationFrame(tick)
    }

    analyzeRafRef.current = window.requestAnimationFrame(tick)
    return () => {
      alive = false
      if (analyzeRafRef.current) window.cancelAnimationFrame(analyzeRafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, streamReady, sideIndex])

  function selectType(option: ResidenceProofOption) {
    setSelectedType(option)
    setCapturedFiles([])
    setCapturedSides([])
    setSideIndex(0)
    setAwaitingNextSide(false)
    setDetect(null)
    setQuality(EMPTY_QUALITY)
    setStep("guide")
  }

  function goToCapture() {
    setStep("capture")
  }

  function humanError(error: unknown, fallback: string) {
    if (error instanceof ApiError) {
      const msg = (error.message || "").trim()
      // Always rewrite bare "Failed to fetch" into an actionable API message
      if (/failed to fetch|networkerror|load failed|fetch failed/i.test(msg) || error.status === 0) {
        return networkErrorMessage(error)
      }
      if (msg) return msg
      if (error.data && typeof error.data === "object") {
        const data = error.data as Record<string, unknown>
        for (const key of ["detail", "message", "proof", "non_field_errors"]) {
          const value = data[key]
          if (typeof value === "string" && value.trim()) {
            if (/failed to fetch/i.test(value)) return networkErrorMessage(error)
            return value.trim()
          }
          if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
            if (/failed to fetch/i.test(value[0])) return networkErrorMessage(error)
            return value[0].trim()
          }
        }
      }
    }
    if (error instanceof TypeError || (error instanceof Error && /failed to fetch|network/i.test(error.message))) {
      return networkErrorMessage(error)
    }
    if (error instanceof Error && error.message.trim()) {
      if (/failed to fetch/i.test(error.message)) return networkErrorMessage(error)
      return error.message.trim()
    }
    return fallback
  }

  async function withNetworkRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      const msg = error instanceof Error ? error.message : ""
      const retriable =
        error instanceof ApiError &&
        (error.status === 0 || error.status >= 500 || /cannot reach the api|timed out|failed to fetch/i.test(msg))
      if (!retriable) throw error
      setProcessingStatus(`${label} — retrying…`)
      await new Promise((r) => window.setTimeout(r, 700))
      return await fn()
    }
  }

  type ProcessOk = {
    ok: true
    file: File
    side: ProofSide
    option: ResidenceProofOption | null
    detect: ResidenceProofDetectResult | null
  }
  type ProcessFail = { ok: false; message: string; detect: ResidenceProofDetectResult | null }
  type ProcessOutcome = ProcessOk | ProcessFail

  /**
   * Validate + detect/check one file for a given side index.
   * Pure enough to chain front then back from a multi-file gallery pick.
   */
  async function processOneFile(args: {
    file: File
    sideIndex: number
    preferredType?: string
    option: ResidenceProofOption | null
    priorDetect: ResidenceProofDetectResult | null
    alreadyCaptured: File[]
    sideLabelForUi?: string
  }): Promise<ProcessOutcome> {
    const { file: rawFile, sideIndex: idx, preferredType, option, priorDetect, alreadyCaptured, sideLabelForUi } =
      args
    const labelPrefix = sideLabelForUi ? `${sideLabelForUi}: ` : ""

    setProcessingStatus(`${labelPrefix}Preparing photo…`)
    const prepared = await prepareProofImage(rawFile, (msg) => setProcessingStatus(`${labelPrefix}${msg}`))
    if (!prepared.ok) {
      return { ok: false, message: prepared.message, detect: priorDetect }
    }
    const file = prepared.file
    if (prepared.message) setStatusBanner(prepared.message)

    // Soft client check after prepare (jpeg should always pass)
    const typeError = getProofOfResidencyFileError(file)
    if (typeError) {
      return { ok: false, message: `${labelPrefix}${typeError}`, detect: priorDetect }
    }

    setProcessingStatus(`${labelPrefix}Checking for duplicates…`)
    const against = [...existingFiles, ...alreadyCaptured]
    for (const existing of against) {
      if (
        existing.name === file.name &&
        existing.size === file.size &&
        existing.lastModified === file.lastModified
      ) {
        return { ok: false, message: `${labelPrefix}This file is already attached.`, detect: priorDetect }
      }
      try {
        const a = await fileDigest(existing)
        const b = await fileDigest(file)
        if (a === b) {
          return {
            ok: false,
            message:
              alreadyCaptured.length > 0 || sidesForOption(option).length > 1
                ? `${labelPrefix}This image is the same as one you already captured. Use a different photo for this side.`
                : `${labelPrefix}Duplicate file upload.`,
            detect: priorDetect,
          }
        }
      } catch {
        // Digest can fail on some browsers; skip duplicate check rather than hang.
      }
    }

    const isFirstSide = idx === 0
    const hint = preferredType || option?.key
    let detectResult: ResidenceProofDetectResult | null = priorDetect
    let resolvedOption = option
    let resolvedType = option?.key || ""

    if (isFirstSide) {
      setProcessingStatus(
        hint
          ? `${labelPrefix}Matching against your selected template…`
          : `${labelPrefix}Detecting document type…`,
      )
      const detectData = new FormData()
      detectData.append("proof", file)
      if (hint) detectData.append("proof_type", hint)
      // First photo is always treated as front for dual-side templates.
      detectData.append("proof_side", "front")

      try {
        detectResult = await withNetworkRetry("Matching template", () =>
          detectRegistrationProof(detectData),
        )
      } catch (error) {
        const data =
          error instanceof ApiError && error.data && typeof error.data === "object"
            ? (error.data as ResidenceProofDetectResult)
            : null
        // 422 returns a full detect body — use it; do not swallow as empty failure.
        // status 0 = network/timeout — surface actionable message
        if (error instanceof ApiError && error.status === 0) {
          detectResult = {
            detected: false,
            message: humanError(error, networkErrorMessage()),
            reasons: [
              humanError(error, "Network error"),
              `API: ${apiBaseUrl()}`,
            ],
          }
        } else {
          detectResult = data ?? {
            detected: false,
            message: humanError(error, "We could not read the document. Try a clearer photo."),
            reasons: [humanError(error, "Detection failed")],
          }
        }
      }

      if (detectResult.detected && detectResult.document_type?.code) {
        const found = proofOptions.find((item) => item.key === detectResult!.document_type!.code)
        if (found) {
          resolvedOption = found
          resolvedType = found.key
        }
      }

      // If user selected a type and detect returned that type even when weak,
      // keep their selection when codes match.
      if (!detectResult.detected && hint && option) {
        resolvedOption = option
        resolvedType = option.key
      }

      if (!detectResult.detected) {
        // If user selected type and server returned that document_type, still fail with clearer msg
        const msg =
          (detectResult.message || "").trim() ||
          (detectResult.reasons?.find((r) => (r || "").trim()) || "").trim() ||
          "This document could not be verified against the selected template. Try a clearer photo."
        return { ok: false, message: `${labelPrefix}${msg}`, detect: detectResult }
      }

      // Prefer selected type when codes differ but user chose explicitly
      if (hint && option && detectResult.document_type?.code && detectResult.document_type.code !== option.key) {
        // keep auto-detected type if server is confident
        const found = proofOptions.find((item) => item.key === detectResult!.document_type!.code)
        if (found) {
          resolvedOption = found
          resolvedType = found.key
        }
      } else if (hint && option) {
        resolvedOption = option
        resolvedType = option.key
      }
    } else {
      setProcessingStatus(`${labelPrefix}Checking ${sideLabel(sidesForOption(option)[idx] ?? "single").toLowerCase()}…`)
      detectResult = priorDetect
      if (!resolvedType && priorDetect?.document_type?.code) {
        resolvedType = priorDetect.document_type.code
        resolvedOption =
          proofOptions.find((item) => item.key === resolvedType) || option
      }
    }

    if (!resolvedType) {
      return {
        ok: false,
        message: `${labelPrefix}Select a document type before uploading.`,
        detect: detectResult,
      }
    }

    setProcessingStatus(`${labelPrefix}Running quality check…`)
    const checkData = new FormData()
    checkData.append("proof_type", resolvedType)
    checkData.append("proof", file)
    try {
      await withNetworkRetry("Quality check", () => checkRegistrationProof(checkData))
    } catch (error) {
      // If detect already passed, do not hard-fail the whole capture on a flaky check
      // network blip — registration will re-validate on submit.
      if (error instanceof ApiError && error.status === 0 && detectResult?.detected) {
        setStatusBanner("Quality check skipped (API briefly unreachable). Photo was already verified.")
      } else {
        return {
          ok: false,
          message: `${labelPrefix}${humanError(error, "File could not be checked. Try a clearer photo.")}`,
          detect: detectResult,
        }
      }
    }

    const sidesNeeded = sidesForOption(resolvedOption)
    const sideForThisCapture = sidesNeeded[idx] ?? "single"
    setProcessingStatus(`${labelPrefix}Verified`)
    return {
      ok: true,
      file,
      side: sideForThisCapture,
      option: resolvedOption,
      detect: detectResult,
    }
  }

  async function commitCapturedFiles(
    files: File[],
    sides: ProofSide[],
    option: ResidenceProofOption | null,
    detectResult: ResidenceProofDetectResult | null,
  ) {
    if (option) setSelectedType(option)
    if (detectResult) setDetect(detectResult)
    setCapturedFiles(files)
    setCapturedSides(sides)
    const sidesNeeded = sidesForOption(option)
    const moreSides = files.length < sidesNeeded.length
    // sideIndex = last completed side (0-based)
    setSideIndex(Math.max(0, files.length - 1))
    setAwaitingNextSide(moreSides)
    setBusy(false)
    stopCamera()
    setStep("success")
  }

  async function processFile(file: File, preferredType?: string) {
    setBusy(true)
    setStatusBanner(null)
    setProcessingStatus("Starting…")
    setStep("processing")
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(file))
    stopCamera()

    try {
      const result = await processOneFile({
        file,
        sideIndex,
        preferredType,
        option: selectedType,
        priorDetect: detect,
        alreadyCaptured: capturedFiles,
        sideLabelForUi: isMultiSide ? sideLabel(currentSide) : undefined,
      })

      if (!result.ok) {
        if (result.detect) setDetect(result.detect)
        setErrorMessage(result.message)
        setBusy(false)
        setStep("error")
        return
      }

      const nextFiles = [...capturedFiles, result.file]
      const nextSides = [...capturedSides, result.side]
      await commitCapturedFiles(nextFiles, nextSides, result.option, result.detect)
    } catch (error) {
      setErrorMessage(humanError(error, "Something went wrong while processing the photo. Try again."))
      setBusy(false)
      setStep("error")
    }
  }

  /**
   * Gallery upload: supports one image for the current side, or both front+back
   * at once when multi-side and user selects 2 files.
   */
  async function processGalleryFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (!files.length) {
      setStatusBanner("No file was selected. Tap Upload again and choose a photo.")
      return
    }
    cancelCountdown()
    stopCamera()

    const baseOption = selectedType
    // When multi-side and user is on the first missing side, allow uploading remaining sides in one pick.
    const nextIndex = capturedFiles.length
    const sidesNeeded = sidesForOption(baseOption)
    const remaining = Math.max(1, sidesNeeded.length - nextIndex)
    const batch = files.slice(0, remaining)

    setBusy(true)
    setStatusBanner(
      batch.length > 1
        ? `Uploading ${batch.length} photos (front then back)…`
        : `Uploading ${batch[0]?.name || "photo"}…`,
    )
    setProcessingStatus("Reading gallery photo…")
    setStep("processing")

    let accFiles = [...capturedFiles]
    let accSides = [...capturedSides]
    let option = baseOption
    let detectResult = detect
    let localIndex = nextIndex
    let lastPreview: string | null = null

    try {
      // Detect is an I/O-bound HTTP OCR call, so front + back run concurrently
      // instead of front-then-back (~2x faster). Each side is independent.
      const jobs = batch.map((file, i) => {
        const sideIndex = nextIndex + i
        const sideName = sideLabel(sidesNeeded[sideIndex] ?? "single")
        setProcessingStatus(
          batch.length > 1 ? `Checking ${sideName}…` : `Processing ${sideName}…`,
        )
        if (lastPreview) URL.revokeObjectURL(lastPreview)
        lastPreview = URL.createObjectURL(file)
        setPreviewUrl(lastPreview)
        return processOneFile({
          file,
          sideIndex,
          preferredType: baseOption?.key,
          option: baseOption,
          priorDetect: detect,
          alreadyCaptured: capturedFiles,
          sideLabelForUi: sidesNeeded.length > 1 ? sideName : undefined,
        })
      })
      const results = await Promise.all(jobs)

      for (const result of results) {
        if (!result.ok) {
          if (result.detect) setDetect(result.detect)
          // Keep any sides that already passed (e.g. front OK, back failed).
          if (accFiles.length > 0) {
            if (option) setSelectedType(option)
            if (detectResult) setDetect(detectResult)
            setCapturedFiles(accFiles)
            setCapturedSides(accSides)
            setSideIndex(Math.min(localIndex, sidesNeeded.length - 1))
            setAwaitingNextSide(false)
          }
          setErrorMessage(result.message)
          setStatusBanner(null)
          setBusy(false)
          setStep("error")
          return
        }

        accFiles = [...accFiles, result.file]
        accSides = [...accSides, result.side]
        option = result.option
        detectResult = result.detect
        localIndex += 1
      }

      setStatusBanner(
        accFiles.length > 1
          ? "Front and back uploaded successfully."
          : "Photo uploaded successfully.",
      )
      await commitCapturedFiles(accFiles, accSides, option, detectResult)
    } catch (error) {
      setErrorMessage(humanError(error, "Upload failed. Please try another photo."))
      setStatusBanner(null)
      setBusy(false)
      setStep("error")
    }
  }

  function continueToNextSide() {
    // Next capture index is the count of files already accepted
    if (capturedFiles.length >= requiredSides.length) return
    setSideIndex(capturedFiles.length)
    setAwaitingNextSide(false)
    setErrorMessage(null)
    setQuality(EMPTY_QUALITY)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setStep("capture")
  }

  async function snapFromVideo() {
    if (capturingRef.current) return
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !streamReady) return
    capturingRef.current = true
    cancelCountdown()
    const width = video.videoWidth || 1280
    const height = video.videoHeight || 720
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      capturingRef.current = false
      return
    }
    ctx.drawImage(video, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92))
    if (!blob) {
      capturingRef.current = false
      setErrorMessage("Could not capture photo. Try Upload from Gallery.")
      setStep("error")
      return
    }
    const sideTag = currentSide === "single" ? "doc" : currentSide
    const file = new File([blob], `capture-${sideTag}-${Date.now()}.jpg`, { type: "image/jpeg" })
    await processFile(file, selectedType?.key)
    capturingRef.current = false
  }

  async function onGalleryChange(event: React.ChangeEvent<HTMLInputElement>) {
    const list = event.target.files
    // Copy FileList before clearing input
    const files = list ? Array.from(list) : []
    event.target.value = ""
    if (!files.length) {
      setStatusBanner("No file was selected.")
      return
    }
    // Immediate feedback before async work (file picker just closed)
    setBusy(true)
    setProcessingStatus("Gallery photo selected…")
    setStep("processing")
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(files[0]))
    await processGalleryFiles(files)
  }

  function finishSuccess() {
    if (!selectedType || capturedFiles.length === 0) return
    if (capturedFiles.length < requiredSides.length) {
      continueToNextSide()
      return
    }
    onComplete({
      proofType: selectedType.key,
      files: capturedFiles,
      sides:
        capturedSides.length === capturedFiles.length
          ? capturedSides
          : requiredSides.slice(0, capturedFiles.length),
      detect,
    })
    onClose()
  }

  const frameRing =
    countdown != null
      ? "ring-emerald-400 shadow-[0_0_40px_rgba(52,211,153,0.55)]"
      : quality.frameColor === "green"
        ? "ring-emerald-400 shadow-[0_0_36px_rgba(52,211,153,0.45)]"
        : quality.frameColor === "yellow"
          ? "ring-amber-400 shadow-[0_0_36px_rgba(251,191,36,0.5)]"
          : quality.frameColor === "red"
            ? "ring-red-400 shadow-[0_0_28px_rgba(248,113,113,0.45)]"
            : "ring-sky-400 shadow-[0_0_28px_rgba(56,189,248,0.4)]"

  const phaseDot = (phase: "searching" | "aligning" | "ready", active: boolean) => {
    const color =
      phase === "searching"
        ? active
          ? "bg-slate-300"
          : "bg-slate-500"
        : phase === "aligning"
          ? active
            ? "bg-amber-400"
            : "bg-slate-500"
          : active
            ? "bg-emerald-400"
            : "bg-slate-500"
    return <span className={cn("size-2 rounded-full", color)} />
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white text-[#0b1f6a]">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-[#e8eef7] px-3 py-2.5 sm:px-4">
        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-full border border-[#e4ebf5] bg-white"
          onClick={() => {
            if (step === "types") onClose()
            else if (step === "guide") setStep("types")
            else if (step === "capture") {
              cancelCountdown()
              stopCamera()
              if (sideIndex > 0) {
                setSideIndex((i) => i - 1)
                setCapturedFiles((files) => files.slice(0, -1))
                setCapturedSides((sides) => sides.slice(0, -1))
                setAwaitingNextSide(true)
                setStep("success")
              } else {
                setStep("guide")
              }
            } else if (step === "error" || step === "success" || step === "processing") {
              if (step === "success" && !awaitingNextSide && capturedFiles.length >= requiredSides.length) {
                setCapturedFiles((files) => files.slice(0, -1))
                setCapturedSides((sides) => sides.slice(0, -1))
                setSideIndex(Math.max(0, requiredSides.length - 1))
              }
              setStep("capture")
            } else onClose()
          }}
          aria-label="Back"
        >
          {step === "types" ? <XIcon className="size-5" /> : <ArrowLeftIcon className="size-5" />}
        </button>
        <div className="text-center">
          <p className="text-sm font-bold tracking-tight sm:text-base">
            {step === "types" && "Select ID Type"}
            {step === "guide" && "How capture works"}
            {(step === "capture" || step === "processing") && "Verify Document"}
            {step === "success" && "Template Validation"}
            {step === "error" && "Template Validation"}
          </p>
          {selectedType && step !== "types" && step !== "capture" && (
            <p className="text-[11px] text-muted-foreground">
              {selectedType.name}
              {isMultiSide ? ` · ${sideIndex + 1} of ${totalSides}` : ""}
            </p>
          )}
        </div>
        {step === "capture" ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={cn(
                "flex size-10 items-center justify-center rounded-full border border-[#e4ebf5] bg-white",
                torchOn && "bg-amber-50 text-amber-600",
              )}
              onClick={() => void toggleTorch()}
              aria-label="Toggle flash"
            >
              <ZapIcon className={cn("size-4", torchOn && "fill-amber-400")} />
            </button>
            <button
              type="button"
              className="flex size-10 items-center justify-center rounded-full border border-[#e4ebf5] bg-white"
              onClick={() => setHelpOpen((v) => !v)}
              aria-label="Help"
            >
              <HelpCircleIcon className="size-4" />
            </button>
          </div>
        ) : (
          <div className="size-10" />
        )}
      </header>

      <div className={cn("min-h-0 flex-1", step === "capture" ? "overflow-hidden" : "overflow-y-auto")}>
        {/* Step: ID type list */}
        {step === "types" && (
          <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 pb-8">
            <div>
              <h1 className="text-xl font-bold">Choose your document</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Select the ID or bill you will capture or upload. We will verify it against the approved Barangay
                templates.
              </p>
            </div>
            {loadingOptions ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-5 animate-spin" />
                Loading document types…
              </div>
            ) : proofOptions.length === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                No document types are published yet. Contact your Barangay Office.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {proofOptions.map((option) => {
                  const sides = sidesForOption(option)
                  return (
                    <li key={option.key}>
                      <button
                        type="button"
                        onClick={() => selectType(option)}
                        className="group flex w-full items-start gap-3 rounded-2xl border border-[#e4ebf5] bg-[#fbfcff] p-4 text-left transition hover:border-[#2563eb]/40 hover:bg-blue-50/50"
                      >
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-black shadow-sm ring-1 ring-[#e4ebf5]">
                          <BoxIdCardIcon />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold text-[#0b1f6a]">{option.name}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {option.description ||
                              (sides.length > 1
                                ? "Front and back required — you will capture both"
                                : "One clear photo of the document")}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {/* Step: guide */}
        {step === "guide" && selectedType && (
          <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 pb-8">
            <div>
              <h1 className="text-xl font-bold">How document capture works</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Follow these steps for faster verification of your {selectedType.name}.
                {isMultiSide ? " You will capture the front, then the back." : ""}
              </p>
            </div>
            {isMultiSide && (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
                <p className="font-semibold">Two photos required</p>
                <p className="mt-0.5 text-xs text-blue-900/80">
                  1) Front side · 2) Back side. Continue only after both sides are captured.
                </p>
              </div>
            )}
            <ol className="flex flex-col gap-3">
              {[
                {
                  n: 1,
                  t: "Place document inside the frame",
                  d: "Position your ID so it fits within the glowing frame.",
                },
                {
                  n: 2,
                  t: "Watch the quality guides",
                  d: "Lighting, blur, corners, and glare tips update live while you aim.",
                },
                {
                  n: 3,
                  t: "Fix any warnings",
                  d: "If you see Poor Lighting or Blurry, follow the on-screen tip before capturing.",
                },
                {
                  n: 4,
                  t: isMultiSide ? "Capture front, then back" : "Hold steady for auto capture",
                  d: isMultiSide
                    ? "After the front is verified, flip the card and capture the back."
                    : "When all checks are green, auto capture counts down 3–2–1.",
                },
                {
                  n: 5,
                  t: isMultiSide
                    ? "Or upload front + back from gallery"
                    : "Or tap the shutter / upload",
                  d: isMultiSide
                    ? "Pick one photo per side, or select both front and back images together from gallery."
                    : "You can always capture manually or pick a photo from your gallery.",
                },
              ].map((item) => (
                <li
                  key={item.n}
                  className="flex gap-3 rounded-2xl border border-[#e4ebf5] bg-white p-3 shadow-sm"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#2563eb] text-sm font-bold text-white">
                    {item.n}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{item.t}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{item.d}</span>
                  </span>
                </li>
              ))}
            </ol>
            <Button
              type="button"
              className="mt-2 h-12 w-full rounded-xl bg-[#2563eb] text-base font-semibold text-white hover:bg-[#1d4ed8]"
              onClick={goToCapture}
            >
              <CameraIcon className="size-5" />
              {isMultiSide ? "Start with front side" : "Start Capture"}
            </Button>
            <button
              type="button"
              className="text-center text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
              onClick={goToCapture}
            >
              Skip tips
            </button>
          </div>
        )}

        {/* Step: guided capture (matches mockups) */}
        {step === "capture" && selectedType && (
          <div className="relative flex h-full min-h-0 flex-col bg-[#0b1220]">
            {/* Live camera / fallback */}
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {useLiveCamera ? (
                <video
                  ref={videoRef}
                  className="absolute inset-0 h-full w-full object-cover"
                  playsInline
                  muted
                  autoPlay
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-[#1e293b] to-[#0f172a] p-6 text-center text-white">
                  <CameraIcon className="size-12 opacity-90" />
                  <p className="text-sm font-semibold">Camera unavailable</p>
                  <p className="max-w-xs text-xs text-white/70">
                    Upload from gallery, or open your phone camera with the shutter button.
                  </p>
                </div>
              )}

              {/* Dark vignette */}
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(0,0,0,0.55)_100%)]" />

              {/* Top status chips */}
              <div className="absolute inset-x-0 top-0 z-10 flex flex-col items-center gap-2 px-3 pt-3">
                {isMultiSide && (
                  <div className="flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur-md">
                    <span className="rounded-full bg-[#2563eb] px-2 py-0.5 text-[10px] font-bold">
                      Step {sideIndex + 1} of {totalSides}
                    </span>
                    <span className="text-white/90">{sideCaptureLabel(currentSide)}</span>
                  </div>
                )}

                {countdown != null ? (
                  <div className="flex items-center gap-2 rounded-full bg-emerald-600/90 px-3 py-1 text-[11px] font-bold text-white shadow-lg">
                    Step {isMultiSide ? `${sideIndex + 1} of ${totalSides}` : "auto"} · Auto Capture
                  </div>
                ) : quality.phase === "aligning" || quality.phase === "ready" ? (
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className={cn(
                        "rounded-full px-3 py-1 text-[11px] font-bold text-white shadow",
                        quality.frameColor === "green"
                          ? "bg-emerald-600"
                          : quality.frameColor === "yellow"
                            ? "bg-amber-500"
                            : "bg-[#2563eb]",
                      )}
                    >
                      {quality.phase === "ready"
                        ? "Ready"
                        : quality.phase === "aligning"
                          ? "Step · Aligning"
                          : "Searching"}
                    </div>
                    <p className="text-center text-sm font-bold text-white drop-shadow">
                      Auto Document Detection
                    </p>
                    <p className="text-center text-[11px] text-white/85 drop-shadow">
                      {quality.guideSubtitle}
                    </p>
                    <div className="mt-0.5 flex items-center gap-3 rounded-full bg-black/45 px-3 py-1 text-[10px] font-semibold text-white/90 backdrop-blur">
                      <span className="flex items-center gap-1">
                        {phaseDot("searching", false)} Searching
                      </span>
                      <span className="flex items-center gap-1">
                        {phaseDot("aligning", quality.phase === "aligning")} Aligning
                      </span>
                      <span className="flex items-center gap-1">
                        {phaseDot("ready", quality.phase === "ready" || countdown != null)} Ready
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-full bg-black/55 px-4 py-1.5 text-xs font-semibold text-white backdrop-blur-md">
                    Place your document inside the frame
                  </div>
                )}
              </div>

              {/* Card frame overlay */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-5">
                <div
                  className={cn(
                    "relative aspect-[1.586/1] w-full max-w-md rounded-2xl ring-4 transition-all duration-300",
                    frameRing,
                  )}
                >
                  {/* Corner brackets */}
                  <span className="absolute -left-0.5 -top-0.5 h-8 w-8 rounded-tl-2xl border-l-4 border-t-4 border-white" />
                  <span className="absolute -right-0.5 -top-0.5 h-8 w-8 rounded-tr-2xl border-r-4 border-t-4 border-white" />
                  <span className="absolute -bottom-0.5 -left-0.5 h-8 w-8 rounded-bl-2xl border-b-4 border-l-4 border-white" />
                  <span className="absolute -bottom-0.5 -right-0.5 h-8 w-8 rounded-br-2xl border-b-4 border-r-4 border-white" />

                  {/* Countdown */}
                  {countdown != null && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className="relative flex size-28 items-center justify-center rounded-full border-2 border-emerald-300/80 bg-black/25 backdrop-blur-sm">
                        <span className="text-6xl font-bold text-white drop-shadow-lg">{countdown}</span>
                      </div>
                      <p className="mt-3 text-sm font-semibold text-white drop-shadow">
                        Auto capturing in
                      </p>
                    </div>
                  )}

                  {!streamReady && useLiveCamera && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/50 text-sm text-white">
                      <LoaderCircleIcon className="mr-2 size-5 animate-spin" />
                      Starting camera…
                    </div>
                  )}
                </div>
              </div>

              {/* Floating status under frame */}
              <div className="absolute inset-x-0 bottom-[11.5rem] z-10 flex flex-col items-center gap-2 px-4 sm:bottom-[12.5rem]">
                {countdown != null || (quality.phase === "ready" && quality.readyForCapture) ? (
                  <div className="flex items-center gap-2 rounded-full bg-emerald-600/90 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur">
                    <CheckCircle2Icon className="size-4" />
                    Perfect alignment detected
                  </div>
                ) : quality.checks.documentDetected === "pass" ? (
                  <div className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur">
                    <CheckCircle2Icon className="size-4 text-emerald-400" />
                    Document Detected · Finalizing alignment…
                  </div>
                ) : quality.checks.documentDetected === "warn" ? (
                  <div className="flex items-center gap-2 rounded-full bg-amber-500/90 px-3 py-1.5 text-xs font-semibold text-amber-950 shadow-lg backdrop-blur">
                    <ApertureIcon className="size-4" />
                    Partial document — fit the full ID in the frame
                  </div>
                ) : streamReady ? (
                  <div className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur">
                    <ScanIcon className="size-4 text-sky-300" />
                    Scanning live video… place ID in the frame
                  </div>
                ) : null}

                {/* Quality checklist panel — driven by live pixel analysis */}
                <div className="w-full max-w-sm rounded-2xl bg-black/55 p-3 shadow-xl backdrop-blur-md">
                  <button
                    type="button"
                    className="mb-2 flex w-full items-center justify-between text-left text-[11px] font-bold uppercase tracking-wide text-white/80"
                    onClick={() => setQualityPanelOpen((v) => !v)}
                  >
                    <span className="flex items-center gap-1.5">
                      <ScanIcon className="size-3.5" />
                      Document Quality
                      {streamReady && (
                        <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold normal-case tracking-normal text-emerald-300">
                          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
                          Live
                        </span>
                      )}
                    </span>
                    <span className="text-white/50">{qualityPanelOpen ? "▾" : "▸"}</span>
                  </button>

                  {qualityPanelOpen && (
                    <div className="space-y-2">
                      <CheckRow
                        icon={<CropIcon className="size-3.5" />}
                        label="Document Detected"
                        status={quality.checks.documentDetected}
                        score={quality.diagnostics?.documentScore ?? 0}
                        showBar
                      />
                      <CheckRow
                        icon={<SunIcon className="size-3.5" />}
                        label="Good Lighting"
                        status={quality.checks.goodLighting}
                        score={quality.metrics.find((m) => m.key === "lighting")?.score}
                        showBar
                      />
                      <CheckRow
                        icon={<Maximize2Icon className="size-3.5" />}
                        label="All Corners Visible"
                        status={quality.checks.allCornersVisible}
                        score={
                          quality.diagnostics
                            ? Math.round(
                                (quality.diagnostics.sideScores.filter((s) => s >= 42).length / 4) *
                                  100,
                              )
                            : quality.metrics.find((m) => m.key === "alignment")?.score
                        }
                        showBar
                      />
                      <CheckRow
                        icon={<FocusIcon className="size-3.5" />}
                        label="Sharp Image"
                        status={quality.checks.sharpImage}
                        score={quality.metrics.find((m) => m.key === "sharpness")?.score}
                        showBar
                      />
                      {/* Detailed meters from live analysis */}
                      <div className="mt-1 space-y-1.5 border-t border-white/10 pt-2">
                        {quality.metrics.map((metric) => (
                          <div key={metric.key} className="flex items-center gap-2 text-[11px] text-white/90">
                            <span className="w-[7.25rem] shrink-0 font-medium">{metric.label}</span>
                            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/15">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all duration-300",
                                  metric.status === "pass"
                                    ? "bg-emerald-400"
                                    : metric.status === "warn"
                                      ? "bg-amber-400"
                                      : "bg-red-500",
                                )}
                                style={{ width: `${metric.score}%` }}
                              />
                            </div>
                            <span className="w-12 shrink-0 text-right text-[10px] font-semibold text-white/80">
                              {metric.detail}
                            </span>
                            <StatusIcon status={metric.status} />
                          </div>
                        ))}
                      </div>
                      {quality.diagnostics && streamReady && (
                        <p className="border-t border-white/10 pt-2 text-[9px] leading-relaxed text-white/45">
                          Live · doc {quality.diagnostics.documentScore} · rim{" "}
                          {quality.diagnostics.borderScore} · min side {quality.diagnostics.minSide} ·
                          range {quality.diagnostics.sideRange} · sides{" "}
                          {quality.diagnostics.sideScores.join("/")} · blur{" "}
                          {quality.diagnostics.laplacianVar}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Coaching banner */}
                {quality.warning && countdown == null && (
                  <div
                    className={cn(
                      "flex w-full max-w-sm items-start gap-2 rounded-2xl px-3 py-2.5 text-sm shadow-lg backdrop-blur",
                      quality.warning.tone === "error"
                        ? "bg-amber-500/95 text-amber-950"
                        : "bg-amber-400/90 text-amber-950",
                    )}
                  >
                    {quality.warning.title.includes("Light") ? (
                      <SunIcon className="mt-0.5 size-4 shrink-0" />
                    ) : quality.warning.title.includes("Blur") ? (
                      <ApertureIcon className="mt-0.5 size-4 shrink-0" />
                    ) : (
                      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                    )}
                    <div>
                      <p className="font-bold leading-tight">{quality.warning.title}</p>
                      <p className="text-xs font-medium opacity-90">{quality.warning.message}</p>
                    </div>
                  </div>
                )}

                {helpOpen && (
                  <div className="w-full max-w-sm rounded-2xl bg-white p-3 text-xs text-[#0b1f6a] shadow-xl">
                    <p className="font-bold">Capture tips</p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground">
                      <li>Fill the frame with all four corners of the ID.</li>
                      <li>Use even lighting — avoid shadows and window glare.</li>
                      <li>Hold steady until checks turn green, then auto capture starts.</li>
                      <li>You can always tap the shutter or upload from gallery.</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Bottom control bar */}
            <div className="relative z-20 border-t border-white/10 bg-white px-4 pb-4 pt-3">
              {statusBanner && (
                <div className="mb-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-950">
                  {statusBanner}
                </div>
              )}
              {cameraError && (
                <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  {cameraError}
                </div>
              )}
              <div className="mx-auto flex max-w-md items-center justify-between gap-3">
                <div className="flex w-24 flex-col items-center gap-1">
                  <span className="text-[11px] font-semibold text-[#0b1f6a]">Auto Capture</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoCapture}
                    onClick={() => {
                      setAutoCapture((v) => {
                        if (v) cancelCountdown()
                        return !v
                      })
                    }}
                    className={cn(
                      "relative h-7 w-12 rounded-full transition-colors",
                      autoCapture ? "bg-[#2563eb]" : "bg-slate-300",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-6 rounded-full bg-white shadow transition-transform",
                        autoCapture ? "left-5" : "left-0.5",
                      )}
                    />
                  </button>
                  <span className="text-[10px] font-bold text-[#2563eb]">{autoCapture ? "ON" : "OFF"}</span>
                </div>

                <button
                  type="button"
                  className="flex size-[4.25rem] items-center justify-center rounded-full bg-[#2563eb] text-white shadow-lg ring-4 ring-blue-100 transition active:scale-95"
                  onClick={() => {
                    if (!useLiveCamera || !streamReady) {
                      mobileCameraRef.current?.click()
                      return
                    }
                    cancelCountdown()
                    void snapFromVideo()
                  }}
                  aria-label="Capture photo"
                >
                  <CameraIcon className="size-8" />
                </button>

                <button
                  type="button"
                  disabled={busy}
                  className="flex w-24 flex-col items-center gap-1 text-[10px] font-semibold text-[#2563eb] disabled:opacity-50"
                  onClick={() => {
                    setStatusBanner(
                      isMultiSide && capturedFiles.length === 0
                        ? "Choose 1 photo (front) or 2 photos (front + back)."
                        : isMultiSide
                          ? `Choose a clear photo of the ${sideLabel(currentSide).toLowerCase()}.`
                          : "Choose a clear JPG or PNG of your document.",
                    )
                    galleryRef.current?.click()
                  }}
                >
                  <span className="flex size-12 items-center justify-center rounded-2xl border border-[#e4ebf5] bg-[#f8faff] shadow-sm">
                    <ImageIcon className="size-5" />
                  </span>
                  {isMultiSide
                    ? currentSide === "back"
                      ? "Upload back"
                      : capturedFiles.length === 0
                        ? "Upload front / both"
                        : "Upload from Gallery"
                    : "Upload from Gallery"}
                </button>
              </div>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
                <InfoIcon className="size-3.5" />
                {countdown != null
                  ? "Hold steady — capturing automatically"
                  : autoCapture
                    ? "Hold steady for automatic capture"
                    : "Tap the shutter when the document looks clear"}
              </p>
            </div>

            <canvas ref={canvasRef} className="hidden" />
          </div>
        )}

        {/* Processing */}
        {step === "processing" && (
          <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 p-8 text-center">
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Captured document"
                className="max-h-48 w-full rounded-xl border object-contain shadow-sm"
              />
            )}
            <LoaderCircleIcon className="size-10 animate-spin text-[#2563eb]" />
            <div>
              <p className="font-semibold text-[#0b1f6a]">{processingStatus || "Processing…"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Please wait — this can take a few seconds for gallery photos.
              </p>
              {selectedType && (
                <p className="mt-2 text-xs font-medium text-[#2563eb]">
                  Template: {selectedType.name}
                  {isMultiSide ? ` · ${sideLabel(currentSide)}` : ""}
                </p>
              )}
            </div>
            <div className="w-full max-w-xs rounded-full bg-slate-100 p-1">
              <div className="h-1.5 animate-pulse rounded-full bg-[#2563eb]/70" style={{ width: "70%" }} />
            </div>
          </div>
        )}

        {/* Success */}
        {step === "success" && (
          <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 pb-8">
            {statusBanner && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
                {statusBanner}
              </div>
            )}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
              <CheckCircle2Icon className="mx-auto size-12 text-emerald-600" />
              <p className="mt-2 text-lg font-bold text-emerald-800">
                {awaitingNextSide
                  ? `${sideLabel(capturedSides[capturedSides.length - 1] ?? "front")} captured`
                  : "Document accepted"}
              </p>
              <p className="text-sm text-emerald-700">
                {awaitingNextSide
                  ? `Next: capture the ${sideLabel(requiredSides[capturedFiles.length] ?? "back").toLowerCase()}`
                  : isMultiSide
                    ? "Front and back verified against the published Barangay template"
                    : `${selectedType?.name || "Document"} matched your selected template`}
              </p>
            </div>

            {isMultiSide && (
              <div className="flex items-center justify-center gap-2">
                {requiredSides.map((side, index) => {
                  const done = index < capturedFiles.length
                  return (
                    <div
                      key={side}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold",
                        done ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500",
                      )}
                    >
                      {done ? <CheckCircle2Icon className="size-3.5" /> : null}
                      {sideLabel(side)}
                    </div>
                  )
                })}
              </div>
            )}

            {!awaitingNextSide && (
              <>
                <div className="rounded-2xl border border-[#e4ebf5] bg-white p-4 text-sm">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Template validation
                  </p>
                  <div className="flex justify-between gap-2 py-1.5">
                    <span className="text-muted-foreground">Selected type</span>
                    <span className="font-semibold">{selectedType?.name || "—"}</span>
                  </div>
                  <div className="flex justify-between gap-2 py-1.5">
                    <span className="text-muted-foreground">Detected type</span>
                    <span className="font-semibold text-emerald-700">
                      {detect?.document_type?.name || selectedType?.name || "—"}
                    </span>
                  </div>
                  {detect?.confidence != null && Number(detect.confidence) > 0 && (
                    <div className="flex justify-between gap-2 py-1.5">
                      <span className="text-muted-foreground">OCR confidence</span>
                      <span className="font-semibold">
                        {`${Math.round(Number(detect.confidence) * 100)}%`}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between gap-2 py-1.5">
                    <span className="text-muted-foreground">Photos attached</span>
                    <span className="font-semibold">
                      {capturedFiles.length}
                      {isMultiSide ? ` of ${totalSides}` : ""}
                    </span>
                  </div>
                  {detect?.deskew?.deskewed ? (
                    <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-900">
                      Auto-aligned: ID card was detected and cropped/straightened to match the
                      template layout before OCR.
                    </div>
                  ) : null}
                </div>

                {(() => {
                  const { rows, json } = flattenExtractedFields(detect?.extracted_fields)
                  const filled = rows.filter((r) => r.value)
                  const jsonText = JSON.stringify(json, null, 2)

                  return (
                    <div className="rounded-2xl border border-[#e4ebf5] bg-white p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                            Extraction result
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {filled.length > 0
                              ? `${filled.length} field${filled.length === 1 ? "" : "s"} with values`
                              : "No field values read — type still accepted"}
                          </p>
                        </div>
                        <div className="flex rounded-lg border border-[#e4ebf5] p-0.5 text-[11px] font-semibold">
                          <button
                            type="button"
                            className={cn(
                              "rounded-md px-2.5 py-1 transition",
                              extractionView === "table"
                                ? "bg-[#2563eb] text-white"
                                : "text-muted-foreground hover:text-[#0b1f6a]",
                            )}
                            onClick={() => setExtractionView("table")}
                          >
                            Fields
                          </button>
                          <button
                            type="button"
                            className={cn(
                              "rounded-md px-2.5 py-1 transition",
                              extractionView === "json"
                                ? "bg-[#2563eb] text-white"
                                : "text-muted-foreground hover:text-[#0b1f6a]",
                            )}
                            onClick={() => setExtractionView("json")}
                          >
                            JSON
                          </button>
                        </div>
                      </div>

                      {extractionView === "table" ? (
                        filled.length === 0 ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                            <p className="font-semibold">No field values extracted</p>
                            <p className="mt-1 text-xs text-amber-900/90">
                              The document type was accepted, but OCR could not read name/address
                              boxes clearly. Enter details on the sign-up form manually, or retake
                              with better lighting.
                            </p>
                            {rows.length > 0 && (
                              <ul className="mt-2 space-y-1 border-t border-amber-200/80 pt-2 text-xs">
                                {rows.map((row) => (
                                  <li key={row.key} className="flex justify-between gap-2 opacity-70">
                                    <span>{row.label}</span>
                                    <span className="font-mono text-amber-900/60">—</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ) : (
                          <div className="overflow-hidden rounded-xl border border-[#e8eef7]">
                            <table className="w-full text-left text-sm">
                              <thead className="bg-[#f8faff] text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                                <tr>
                                  <th className="px-3 py-2">Field</th>
                                  <th className="px-3 py-2">Value</th>
                                  <th className="px-3 py-2 text-right">Conf.</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((row) => (
                                  <tr
                                    key={row.key}
                                    className="border-t border-[#eef2f8] align-top"
                                  >
                                    <td className="px-3 py-2">
                                      <span className="font-medium text-[#0b1f6a]">{row.label}</span>
                                      <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                                        {row.key}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 font-medium text-[#0b1f6a]">
                                      {row.value ? (
                                        <span className="break-words">{row.value}</span>
                                      ) : (
                                        <span className="text-muted-foreground">—</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                                      {row.confidence != null
                                        ? `${Math.round(row.confidence * 100)}%`
                                        : row.value
                                          ? "—"
                                          : ""}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )
                      ) : (
                        <div className="relative">
                          <pre className="max-h-64 overflow-auto rounded-xl border border-[#e8eef7] bg-[#0b1220] p-3 text-left text-[11px] leading-relaxed text-emerald-100">
                            {filled.length > 0
                              ? jsonText
                              : "{\n  // No field values extracted\n}"}
                          </pre>
                          {filled.length > 0 && (
                            <button
                              type="button"
                              className="absolute right-2 top-2 rounded-md border border-white/20 bg-white/10 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur hover:bg-white/20"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(jsonText)
                                  setJsonCopied(true)
                                  window.setTimeout(() => setJsonCopied(false), 1600)
                                } catch {
                                  // ignore
                                }
                              }}
                            >
                              {jsonCopied ? "Copied" : "Copy JSON"}
                            </button>
                          )}
                        </div>
                      )}

                      {filled.length > 0 && (
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          These values can pre-fill your sign-up form. Review them before submitting.
                        </p>
                      )}
                    </div>
                  )
                })()}

                {previewUrl && (
                  <div>
                    <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Document preview
                    </p>
                    <img
                      src={previewUrl}
                      alt="Document preview"
                      className="max-h-44 w-full rounded-xl border object-contain bg-white"
                    />
                  </div>
                )}

                {capturedFiles.length > 1 && (
                  <div className="rounded-xl border border-[#e4ebf5] bg-white p-3 text-xs text-muted-foreground">
                    {capturedFiles.map((file, i) => (
                      <div key={`${file.name}-${i}`} className="flex justify-between gap-2 py-0.5">
                        <span className="font-medium text-[#0b1f6a]">
                          {sideLabel(capturedSides[i] ?? "single")}
                        </span>
                        <span className="truncate">{file.name}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-950">
                  <p className="font-semibold">What happens next?</p>
                  <p className="mt-0.5 text-blue-900/90">
                    Tap <strong>Continue to sign-up form</strong> to attach this photo and return to
                    registration. Complete your name, address, and other fields, then submit your
                    account for barangay review.
                  </p>
                </div>
              </>
            )}

            {awaitingNextSide ? (
              <div className="flex flex-col gap-2">
                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt="Captured side preview"
                    className="max-h-36 w-full rounded-xl border object-contain"
                  />
                )}
                <Button
                  type="button"
                  className="h-12 w-full rounded-xl bg-[#2563eb] text-base font-semibold text-white hover:bg-[#1d4ed8]"
                  onClick={continueToNextSide}
                  disabled={busy}
                >
                  <CameraIcon className="size-5" />
                  Capture {sideLabel(requiredSides[capturedFiles.length] ?? "back").toLowerCase()}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full rounded-xl"
                  onClick={() => galleryRef.current?.click()}
                  disabled={busy}
                >
                  <ImageIcon className="size-5" />
                  Upload {sideLabel(requiredSides[capturedFiles.length] ?? "back").toLowerCase()} from gallery
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                className="h-12 w-full rounded-xl bg-[#2563eb] text-base font-semibold text-white hover:bg-[#1d4ed8]"
                onClick={finishSuccess}
                disabled={busy || capturedFiles.length < requiredSides.length}
              >
                Continue to sign-up form
              </Button>
            )}
          </div>
        )}

        {/* Error */}
        {step === "error" && (
          <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4 pb-8">
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <div className="flex items-start gap-2">
                <XCircleIcon className="mt-0.5 size-5 shrink-0 text-red-600" />
                <div>
                  <p className="font-bold text-red-800">
                    {sideIndex > 0 ? `${sideLabel(currentSide)} not accepted` : "Could not verify document"}
                  </p>
                  <p className="mt-1 text-sm text-red-700">
                    {(errorMessage || "").trim() ||
                      "This document could not be verified. Try a clearer photo or contact your Barangay Office."}
                  </p>
                  {selectedType && (
                    <p className="mt-2 text-xs text-red-800/80">
                      Selected template: <strong>{selectedType.name}</strong>
                    </p>
                  )}
                </div>
              </div>
            </div>
            {detect?.reasons && detect.reasons.length > 0 && (
              <div className="rounded-2xl border border-[#e4ebf5] bg-white p-4">
                <p className="mb-2 text-xs font-bold text-muted-foreground">Details</p>
                <ul className="space-y-1.5 text-sm text-[#0b1f6a]">
                  {detect.reasons.filter(Boolean).map((reason) => (
                    <li key={reason} className="flex gap-2">
                      <span className="text-red-500">×</span>
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-12 flex-1 rounded-xl"
                disabled={busy}
                onClick={() => {
                  setErrorMessage(null)
                  setStatusBanner(null)
                  if (sideIndex === 0 && capturedFiles.length === 0) setDetect(null)
                  setStep("capture")
                }}
              >
                <CameraIcon className="size-4" />
                Retake
              </Button>
              <Button
                type="button"
                className="h-12 flex-1 rounded-xl bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
                disabled={busy}
                onClick={() => {
                  setStatusBanner("Choose another photo from your gallery…")
                  galleryRef.current?.click()
                }}
              >
                {busy ? (
                  <>
                    <LoaderCircleIcon className="size-4 animate-spin" />
                    Working…
                  </>
                ) : (
                  "Upload again"
                )}
              </Button>
            </div>
          </div>
        )}
      </div>

      <input
        ref={galleryRef}
        type="file"
        accept="image/png,image/jpeg,.png,.jpg,.jpeg"
        multiple={isMultiSide && capturedFiles.length === 0}
        className="hidden"
        onChange={onGalleryChange}
      />
      <input
        ref={mobileCameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onGalleryChange}
      />
    </div>
  )
}
