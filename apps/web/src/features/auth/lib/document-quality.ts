/**
 * Production client-side document frame quality analysis for ID capture.
 *
 * Conservative by design: busy rooms, faces, and empty desks must NOT
 * report Document Detected / Ready / Perfect alignment.
 *
 * Core idea: a real ID filling the guide frame produces:
 *  - Continuous edges on ALL 4 borders (directional: H on top/bottom, V on sides)
 *  - Similar strength on all sides (low side-score range)
 *  - Some interior structure (text/photo) without being pure clutter
 */

export type QualityStatus = "fail" | "warn" | "pass"

export interface QualityMetric {
  key: string
  label: string
  score: number
  status: QualityStatus
  detail?: string
}

export type CaptureGuidePhase = "searching" | "aligning" | "ready" | "countdown"

export interface DocumentQualityResult {
  metrics: QualityMetric[]
  checks: {
    documentDetected: QualityStatus
    goodLighting: QualityStatus
    allCornersVisible: QualityStatus
    sharpImage: QualityStatus
    glare: QualityStatus
    ocrReadability: QualityStatus
    alignment: QualityStatus
  }
  phase: CaptureGuidePhase
  guideTitle: string
  guideSubtitle: string
  warning: { title: string; message: string; tone: "warn" | "error" } | null
  readyForCapture: boolean
  frameColor: "blue" | "yellow" | "green" | "red"
  diagnostics: {
    meanLuma: number
    laplacianVar: number
    borderScore: number
    documentScore: number
    sideScores: [number, number, number, number]
    glarePct: number
    motion: number
    sampleW: number
    sampleH: number
    minSide: number
    sideRange: number
    rectScore: number
  }
}

function clamp(n: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n))
}

function statusFromScore(score: number, passAt: number, warnAt: number): QualityStatus {
  if (score >= passAt) return "pass"
  if (score >= warnAt) return "warn"
  return "fail"
}

function glareDetail(glarePct: number): string {
  if (glarePct < 1.2) return "None"
  if (glarePct < 3.5) return "Mild"
  if (glarePct < 8) return "Strong"
  return "Severe"
}

function readabilityDetail(score: number): string {
  if (score >= 72) return "Good"
  if (score >= 52) return "Fair"
  if (score >= 35) return "Poor"
  return "Unreadable"
}

function emptyDiagnostics() {
  return {
    meanLuma: 0,
    laplacianVar: 0,
    borderScore: 0,
    documentScore: 0,
    sideScores: [0, 0, 0, 0] as [number, number, number, number],
    glarePct: 0,
    motion: 0,
    sampleW: 0,
    sampleH: 0,
    minSide: 0,
    sideRange: 0,
    rectScore: 0,
  }
}

export function emptyQualityResult(subtitle = "Starting camera…"): DocumentQualityResult {
  return {
    metrics: [
      { key: "sharpness", label: "Sharpness", score: 0, status: "fail", detail: "0%" },
      { key: "alignment", label: "Alignment", score: 0, status: "fail", detail: "0%" },
      { key: "lighting", label: "Lighting", score: 0, status: "fail", detail: "0%" },
      { key: "glare", label: "Glare", score: 0, status: "fail", detail: "—" },
      { key: "ocr", label: "OCR Readability", score: 0, status: "fail", detail: "—" },
    ],
    checks: {
      documentDetected: "fail",
      goodLighting: "fail",
      allCornersVisible: "fail",
      sharpImage: "fail",
      glare: "fail",
      ocrReadability: "fail",
      alignment: "fail",
    },
    phase: "searching",
    guideTitle: "Place your document inside the frame",
    guideSubtitle: subtitle,
    warning: {
      title: "No Document Found",
      message: "Place your ID card inside the frame so all edges are visible.",
      tone: "warn",
    },
    readyForCapture: false,
    frameColor: "blue",
    diagnostics: emptyDiagnostics(),
  }
}

interface RawScores {
  document: number
  lighting: number
  corners: number
  sharpness: number
  glareGood: number
  alignment: number
  ocr: number
  meanLuma: number
  laplacianVar: number
  borderScore: number
  sideScores: [number, number, number, number]
  glarePct: number
  motion: number
  sampleW: number
  sampleH: number
  minSide: number
  sideRange: number
  rectScore: number
}

/** Side pass thresholds — loosened for phone capture (still rejects empty desks). */
const SIDE_STRONG = 48
const SIDE_OK = 38
const SIDE_WEAK = 28
/** Max allowed spread between strongest and weakest side for a card outline. */
const MAX_SIDE_RANGE_FOR_DOC = 38
/** Document pass requires this many strong sides. */
const MIN_STRONG_SIDES_FOR_DOC = 2
const MIN_OK_SIDES_FOR_DOC = 3

/**
 * Stateful analyzer with EMA smoothing. Document score uses slower EMA +
 * hard gates so false Ready cannot stick from a lucky frame.
 */
export class DocumentQualityAnalyzer {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private prevGray: Float32Array | null = null
  private ema: Partial<Record<string, number>> = {}
  private readonly sampleW = 280
  private readonly sampleH = 176
  /** Consecutive frames that passed hard document gates (anti-flicker). */
  private docPassStreak = 0

  reset() {
    this.prevGray = null
    this.ema = {}
    this.docPassStreak = 0
  }

  private ensureCanvas() {
    if (!this.canvas) {
      this.canvas = document.createElement("canvas")
      this.canvas.width = this.sampleW
      this.canvas.height = this.sampleH
      this.ctx = this.canvas.getContext("2d", {
        willReadFrequently: true,
        alpha: false,
      })
    }
    return this.ctx
  }

  private smooth(key: string, value: number, alpha: number): number {
    const prev = this.ema[key]
    const next = prev == null ? value : prev * (1 - alpha) + value * alpha
    this.ema[key] = next
    return next
  }

  analyze(source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement): DocumentQualityResult {
    const ctx = this.ensureCanvas()
    if (!ctx || !this.canvas) {
      return emptyQualityResult("Camera not ready")
    }

    const sw =
      "videoWidth" in source
        ? source.videoWidth
        : "naturalWidth" in source
          ? source.naturalWidth || source.width
          : source.width
    const sh =
      "videoHeight" in source
        ? source.videoHeight
        : "naturalHeight" in source
          ? source.naturalHeight || source.height
          : source.height

    if (!sw || !sh) {
      return emptyQualityResult("Waiting for video…")
    }

    // Match on-screen card frame
    const targetAspect = 1.586
    let rw = sw * 0.72
    let rh = rw / targetAspect
    if (rh > sh * 0.62) {
      rh = sh * 0.62
      rw = rh * targetAspect
    }
    const rx = (sw - rw) / 2
    const ry = (sh - rh) / 2

    try {
      ctx.drawImage(source, rx, ry, rw, rh, 0, 0, this.sampleW, this.sampleH)
    } catch {
      return emptyQualityResult("Unable to read camera frame")
    }

    let imageData: ImageData
    try {
      imageData = ctx.getImageData(0, 0, this.sampleW, this.sampleH)
    } catch {
      return emptyQualityResult("Camera frame blocked")
    }

    const raw = this.computeRaw(imageData)

    // Hard structural gate from THIS frame (not EMA) — prevents sticky false positives
    const hardDocOk =
      raw.minSide >= SIDE_WEAK &&
      raw.sideRange <= MAX_SIDE_RANGE_FOR_DOC + 8 &&
      raw.sideScores.filter((s) => s >= SIDE_OK).length >= 3 &&
      raw.borderScore >= 48 &&
      raw.rectScore >= 55

    if (hardDocOk) this.docPassStreak = Math.min(12, this.docPassStreak + 1)
    else this.docPassStreak = Math.max(0, this.docPassStreak - 2)

    // Document score: pull toward raw quickly on fail, slower on rise
    const docAlpha = raw.document < (this.ema.document ?? 0) ? 0.55 : 0.28
    let document = this.smooth("document", raw.document, docAlpha)
    // If hard gate fails, clamp smoothed document score so UI cannot stay green
    if (!hardDocOk) {
      document = Math.min(document, 38)
      this.ema.document = document
    }
    // Require short streak before allowing high document score
    if (this.docPassStreak < 3) {
      document = Math.min(document, 48)
    }

    const lighting = this.smooth("lighting", raw.lighting, 0.3)
    let corners = this.smooth("corners", raw.corners, 0.35)
    let sharpness = this.smooth("sharpness", raw.sharpness, 0.3)
    let glareGood = this.smooth("glareGood", raw.glareGood, 0.3)
    let alignment = this.smooth("alignment", raw.alignment, 0.35)
    let ocr = this.smooth("ocr", raw.ocr, 0.3)
    const motion = this.smooth("motion", raw.motion, 0.45)

    // When no document, pull dependent meters down so they don't show fake greens
    if (document < 50) {
      corners = Math.min(corners, 35)
      alignment = Math.min(alignment, 40)
      ocr = Math.min(ocr, 32)
      // Glare "None" on empty scenes is fine; don't show as pass of document quality
      if (document < 35) {
        glareGood = Math.min(glareGood, 50)
        // Sharpness of room clutter is not "sharp ID"
        sharpness = Math.min(sharpness, 45)
      }
      this.ema.corners = corners
      this.ema.alignment = alignment
      this.ema.ocr = ocr
      this.ema.glareGood = glareGood
      this.ema.sharpness = sharpness
    }

    return buildResult({
      ...raw,
      document,
      lighting,
      corners,
      sharpness,
      glareGood,
      alignment,
      ocr,
      motion,
      hardDocOk,
      docPassStreak: this.docPassStreak,
    })
  }

  private computeRaw(imageData: ImageData): RawScores {
    const { data, width, height } = imageData
    const pixels = width * height
    const gray = new Float32Array(pixels)
    const gxMap = new Float32Array(pixels)
    const gyMap = new Float32Array(pixels)

    let sum = 0
    let sumSq = 0
    let brightCount = 0

    // `brightCount` feeds glarePct below. A parallel `veryDark` counter was
    // tallied here and never read by anything — the underexposure check it was
    // presumably meant to feed does not exist. Dropped rather than left in:
    // this loop runs over every pixel of every camera frame, so an unused
    // compare-and-increment is paid continuously while the capture UI is open.
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      gray[p] = g
      sum += g
      sumSq += g * g
      if (g >= 245) brightCount++
    }

    const mean = sum / pixels
    const variance = Math.max(0, sumSq / pixels - mean * mean)
    const std = Math.sqrt(variance)

    // Motion
    let motionScore = 0
    if (this.prevGray && this.prevGray.length === gray.length) {
      let diff = 0
      for (let i = 0; i < gray.length; i += 4) {
        diff += Math.abs(gray[i] - this.prevGray[i])
      }
      motionScore = diff / Math.ceil(gray.length / 4)
    }
    this.prevGray = gray.slice()

    // Laplacian variance (sharpness)
    let lapSum = 0
    let lapSumSq = 0
    let lapN = 0
    let edgeSum = 0
    let edgeN = 0
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        const gx =
          -gray[i - width - 1] +
          gray[i - width + 1] -
          2 * gray[i - 1] +
          2 * gray[i + 1] -
          gray[i + width - 1] +
          gray[i + width + 1]
        const gy =
          -gray[i - width - 1] -
          2 * gray[i - width] -
          gray[i - width + 1] +
          gray[i + width - 1] +
          2 * gray[i + width] +
          gray[i + width + 1]
        gxMap[i] = gx
        gyMap[i] = gy
        const mag = Math.hypot(gx, gy)
        edgeSum += mag
        edgeN++
        const lap =
          gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i]
        lapSum += lap
        lapSumSq += lap * lap
        lapN++
      }
    }
    const lapMean = lapN ? lapSum / lapN : 0
    const laplacianVar = lapN ? Math.max(0, lapSumSq / lapN - lapMean * lapMean) : 0
    const edgeMean = edgeN ? edgeSum / edgeN : 0

    let sharpnessScore = clamp((Math.log1p(laplacianVar) / Math.log1p(1200)) * 100)
    if (motionScore > 10) {
      sharpnessScore = clamp(sharpnessScore - (motionScore - 10) * 4)
    }

    // Directional 4-side scores (card rectangle)
    const strip = Math.max(5, Math.floor(Math.min(width, height) * 0.11))
    const top = directionalSideScore(gxMap, gyMap, width, height, "top", strip)
    const bottom = directionalSideScore(gxMap, gyMap, width, height, "bottom", strip)
    const left = directionalSideScore(gxMap, gyMap, width, height, "left", strip)
    const right = directionalSideScore(gxMap, gyMap, width, height, "right", strip)
    const sideScores: [number, number, number, number] = [top, bottom, left, right]

    const minSide = Math.min(top, bottom, left, right)
    const maxSide = Math.max(top, bottom, left, right)
    const sideRange = maxSide - minSide
    const borderScore = (top + bottom + left + right) / 4
    const strongSides = sideScores.filter((s) => s >= SIDE_STRONG).length
    const okSides = sideScores.filter((s) => s >= SIDE_OK).length
    const weakOnly = sideScores.filter((s) => s >= SIDE_WEAK).length

    // Interior structure (text on ID) — moderate edges expected
    const insetX = Math.floor(width * 0.2)
    const insetY = Math.floor(height * 0.2)
    let interiorEdge = 0
    let interiorN = 0
    for (let y = insetY; y < height - insetY; y++) {
      for (let x = insetX; x < width - insetX; x++) {
        interiorEdge += Math.hypot(gxMap[y * width + x], gyMap[y * width + x])
        interiorN++
      }
    }
    const interiorMean = interiorN ? interiorEdge / interiorN : 0

    // Rectangularity: all sides present + low range (room clutter has high range)
    const balanceScore = clamp(100 - sideRange * 2.4)
    const coverageScore = clamp((strongSides / 4) * 55 + (okSides / 4) * 35 + (weakOnly / 4) * 10)
    const rectScore = clamp(coverageScore * 0.55 + balanceScore * 0.3 + clamp(borderScore) * 0.15)

    // Card should have border comparable to or stronger than noisy interior clutter ratio
    // Rooms often have high interior edges everywhere without a clean rectangular rim.
    const borderVsInterior = borderScore / Math.max(12, interiorMean * 0.85 + 12)
    const rimBonus = clamp((borderVsInterior - 0.75) * 40, -20, 20)

    let documentScore = clamp(rectScore * 0.7 + clamp(minSide) * 0.2 + rimBonus * 0.1)

    // ——— HARD CAPS (these kill the false positive in the screenshot) ———
    // Uneven sides (78 vs 15) → not a card outline
    if (sideRange > MAX_SIDE_RANGE_FOR_DOC) {
      documentScore = Math.min(documentScore, 32)
    }
    if (sideRange > 40) {
      documentScore = Math.min(documentScore, 22)
    }
    // Any side missing → cannot be full document in frame
    if (minSide < SIDE_WEAK) {
      documentScore = Math.min(documentScore, 28)
    }
    if (minSide < 25) {
      documentScore = Math.min(documentScore, 18)
    }
    // Need nearly all sides OK
    if (okSides < MIN_OK_SIDES_FOR_DOC) {
      documentScore = Math.min(documentScore, 40)
    }
    if (strongSides < MIN_STRONG_SIDES_FOR_DOC) {
      documentScore = Math.min(documentScore, 48)
    }
    if (strongSides < 2) {
      documentScore = Math.min(documentScore, 30)
    }
    // Almost no edges / blank
    if (edgeMean < 14 && laplacianVar < 50) {
      documentScore = Math.min(documentScore, 15)
    }
    // Extreme lighting
    if (mean < 30 || mean > 235) {
      documentScore = Math.min(documentScore, 30)
    }
    // Very low contrast often not a printed ID
    if (std < 12) {
      documentScore = Math.min(documentScore, 25)
    }

    // Corners: need structure in all 4 corners of the frame
    const cw = Math.floor(width * 0.18)
    const ch = Math.floor(height * 0.18)
    const cornerVals = [
      patchMag(gxMap, gyMap, width, 0, 0, cw, ch),
      patchMag(gxMap, gyMap, width, width - cw, 0, cw, ch),
      patchMag(gxMap, gyMap, width, 0, height - ch, cw, ch),
      patchMag(gxMap, gyMap, width, width - cw, height - ch, cw, ch),
    ]
    const cornersStrong = cornerVals.filter((v) => v >= 22).length
    let cornersScore = clamp((cornersStrong / 4) * 100)
    // Corners only count if document rim is plausible
    if (documentScore < 45) {
      cornersScore = Math.min(cornersScore, 30)
    }
    if (minSide < SIDE_WEAK) {
      cornersScore = Math.min(cornersScore, 25)
    }

    // Lighting
    let lightingScore: number
    if (mean < 45) lightingScore = clamp(mean * 1.1)
    else if (mean < 85) lightingScore = clamp(35 + (mean - 45) * 1.4)
    else if (mean <= 175) lightingScore = clamp(78 + (1 - Math.abs(mean - 130) / 50) * 22)
    else if (mean <= 210) lightingScore = clamp(70 - (mean - 175) * 1.2)
    else lightingScore = clamp(30 - (mean - 210) * 0.8)
    if (std < 15) lightingScore = clamp(lightingScore - 20)

    // Glare
    const glarePct = (brightCount / pixels) * 100
    let glareGood = clamp(100 - glarePct * 9)
    if (glarePct > 2 && mean > 160) glareGood = clamp(glareGood - 15)

    // Alignment — only high when rectangle is balanced in frame
    let alignmentScore = clamp(
      (okSides / 4) * 35 +
        (strongSides / 4) * 25 +
        clamp(minSide) * 0.2 +
        balanceScore * 0.15 +
        cornersScore * 0.1,
    )
    if (sideRange > MAX_SIDE_RANGE_FOR_DOC) alignmentScore = Math.min(alignmentScore, 35)
    if (minSide < SIDE_WEAK) alignmentScore = Math.min(alignmentScore, 28)
    if (motionScore > 16) alignmentScore = clamp(alignmentScore - 20)

    // OCR proxy only if document exists
    let ocrScore = clamp(
      sharpnessScore * 0.35 + lightingScore * 0.2 + glareGood * 0.1 + documentScore * 0.35,
    )
    if (documentScore < 50) ocrScore = Math.min(ocrScore, 30)
    if (documentScore < 35) ocrScore = Math.min(ocrScore, 18)

    // When no document, don't report excellent glare/sharpness as document quality
    if (documentScore < 40) {
      glareGood = Math.min(glareGood, 55)
    }

    return {
      document: documentScore,
      lighting: lightingScore,
      corners: cornersScore,
      sharpness: sharpnessScore,
      glareGood,
      alignment: alignmentScore,
      ocr: ocrScore,
      meanLuma: mean,
      laplacianVar,
      borderScore,
      sideScores,
      glarePct,
      motion: motionScore,
      sampleW: width,
      sampleH: height,
      minSide,
      sideRange,
      rectScore,
    }
  }
}

/**
 * Score one side of the ROI using the gradient direction expected for a card edge:
 * top/bottom → strong |gy| (horizontal edge), left/right → strong |gx| (vertical edge).
 * Requires continuous coverage along the side (not a single spike from furniture).
 */
function directionalSideScore(
  gxMap: Float32Array,
  gyMap: Float32Array,
  width: number,
  height: number,
  side: "top" | "bottom" | "left" | "right",
  strip: number,
): number {
  const bins = 28
  const strengths: number[] = []
  const dirStrengths: number[] = [] // directional component only

  if (side === "top" || side === "bottom") {
    const y0 = side === "top" ? 1 : height - strip - 1
    const y1 = side === "top" ? strip : height - 2
    const binW = Math.max(1, Math.floor(width / bins))
    for (let b = 0; b < bins; b++) {
      let magSum = 0
      let dirSum = 0
      let n = 0
      const x0 = b * binW
      const x1 = Math.min(width - 1, b === bins - 1 ? width - 1 : x0 + binW)
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * width + x
          const gx = gxMap[i]
          const gy = gyMap[i]
          magSum += Math.hypot(gx, gy)
          dirSum += Math.abs(gy) // horizontal edge
          n++
        }
      }
      strengths.push(n ? magSum / n : 0)
      dirStrengths.push(n ? dirSum / n : 0)
    }
  } else {
    const x0 = side === "left" ? 1 : width - strip - 1
    const x1 = side === "left" ? strip : width - 2
    const binH = Math.max(1, Math.floor(height / bins))
    for (let b = 0; b < bins; b++) {
      let magSum = 0
      let dirSum = 0
      let n = 0
      const y0 = b * binH
      const y1 = Math.min(height - 1, b === bins - 1 ? height - 1 : y0 + binH)
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * width + x
          const gx = gxMap[i]
          const gy = gyMap[i]
          magSum += Math.hypot(gx, gy)
          dirSum += Math.abs(gx) // vertical edge
          n++
        }
      }
      strengths.push(n ? magSum / n : 0)
      dirStrengths.push(n ? dirSum / n : 0)
    }
  }

  // Continuous coverage: fraction of bins with directional edge above threshold
  const thr = 18
  const strongBins = dirStrengths.filter((s) => s >= thr).length
  const coverage = strongBins / bins
  const avgDir = dirStrengths.reduce((a, b) => a + b, 0) / bins
  const avgMag = strengths.reduce((a, b) => a + b, 0) / bins

  // Reject sides that are only a couple of spikes (furniture) — need span
  const firstStrong = dirStrengths.findIndex((s) => s >= thr)
  const lastStrong = (() => {
    for (let i = dirStrengths.length - 1; i >= 0; i--) {
      if (dirStrengths[i] >= thr) return i
    }
    return -1
  })()
  const span =
    firstStrong >= 0 && lastStrong >= firstStrong
      ? (lastStrong - firstStrong + 1) / bins
      : 0

  // Score: coverage + strength + span (all needed for a card edge)
  return clamp(coverage * 45 + clamp(avgDir * 1.15) * 0.25 + span * 30 + clamp(avgMag * 0.4) * 0.1)
}

function patchMag(
  gxMap: Float32Array,
  gyMap: Float32Array,
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
): number {
  let sum = 0
  let n = 0
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = y * width + x
      sum += Math.hypot(gxMap[i], gyMap[i])
      n++
    }
  }
  return n ? sum / n : 0
}

function buildResult(
  s: RawScores & { hardDocOk?: boolean; docPassStreak?: number },
): DocumentQualityResult {
  // Easier pass/warn so phone framing can reach yellow/blue
  const docPassAt = 55
  const docWarnAt = 38

  const checks = {
    documentDetected: statusFromScore(s.document, docPassAt, docWarnAt),
    goodLighting: statusFromScore(s.lighting, 55, 35),
    allCornersVisible: statusFromScore(s.corners, 55, 35),
    sharpImage: statusFromScore(s.sharpness, 45, 28),
    glare: statusFromScore(s.glareGood, 55, 35),
    ocrReadability: statusFromScore(s.ocr, 50, 30),
    alignment: statusFromScore(s.alignment, 52, 32),
  }

  // Structural veto even if EMA score is high (still reject empty desks)
  const strongSides = s.sideScores.filter((side) => side >= SIDE_STRONG).length
  const okSides = s.sideScores.filter((side) => side >= SIDE_OK).length
  if (
    s.minSide < SIDE_WEAK - 4 ||
    s.sideRange > MAX_SIDE_RANGE_FOR_DOC + 12 ||
    okSides < 2 ||
    strongSides < 1
  ) {
    checks.documentDetected = "fail"
  }

  // No document → dependent checks cannot show full green success state
  if (checks.documentDetected === "fail") {
    checks.allCornersVisible = "fail"
    checks.alignment = s.alignment >= 45 ? "warn" : "fail"
    checks.ocrReadability = "fail"
    if (s.document < 40) {
      checks.sharpImage = s.sharpness >= 58 ? "warn" : statusFromScore(Math.min(s.sharpness, 40), 58, 38)
    }
  } else if (checks.documentDetected === "warn") {
    if (checks.allCornersVisible === "pass") checks.allCornersVisible = "warn"
    if (checks.alignment === "pass") checks.alignment = "warn"
    if (checks.ocrReadability === "pass") checks.ocrReadability = "warn"
  }

  const metrics: QualityMetric[] = [
    {
      key: "sharpness",
      label: "Sharpness",
      score: Math.round(s.sharpness),
      status: checks.sharpImage,
      detail: `${Math.round(s.sharpness)}%`,
    },
    {
      key: "alignment",
      label: "Alignment",
      score: Math.round(s.alignment),
      status: checks.alignment,
      detail: `${Math.round(s.alignment)}%`,
    },
    {
      key: "lighting",
      label: "Lighting",
      score: Math.round(s.lighting),
      status: checks.goodLighting,
      detail: `${Math.round(s.lighting)}%`,
    },
    {
      key: "glare",
      label: "Glare",
      score: Math.round(s.glareGood),
      status: checks.glare,
      detail: glareDetail(s.glarePct),
    },
    {
      key: "ocr",
      label: "OCR Readability",
      score: Math.round(s.ocr),
      status: checks.ocrReadability,
      detail: readabilityDetail(s.ocr),
    },
  ]

  // Softer "ready" so yellow/blue feedback is reachable on phones (guidance only).
  const readyForCapture =
    (checks.documentDetected === "pass" || checks.documentDetected === "warn") &&
    checks.allCornersVisible !== "fail" &&
    checks.alignment !== "fail" &&
    checks.sharpImage !== "fail" &&
    checks.goodLighting !== "fail" &&
    s.motion < 22 &&
    strongSides >= MIN_STRONG_SIDES_FOR_DOC &&
    okSides >= MIN_OK_SIDES_FOR_DOC &&
    s.minSide >= SIDE_WEAK &&
    s.sideRange <= MAX_SIDE_RANGE_FOR_DOC + 8 &&
    (s.docPassStreak ?? 0) >= 2

  const aligning =
    checks.documentDetected === "pass" ||
    checks.documentDetected === "warn" ||
    (s.document >= 40 && s.minSide >= SIDE_WEAK)

  const phase: CaptureGuidePhase = readyForCapture
    ? "ready"
    : aligning
      ? "aligning"
      : "searching"

  let warning: DocumentQualityResult["warning"] = null
  if (checks.documentDetected === "fail") {
    warning = {
      title: "No Document Found",
      message:
        s.minSide < SIDE_WEAK || s.sideRange > 35
          ? "No ID card outline found. Place the full document inside the frame."
          : "Place your ID card inside the frame so all four edges are visible.",
      tone: "warn",
    }
  } else if (checks.goodLighting === "fail") {
    warning = {
      title: "Poor Lighting",
      message:
        s.meanLuma < 90
          ? "Move to a brighter area."
          : "Too bright — avoid direct sun or harsh flash on the card.",
      tone: "error",
    }
  } else if (checks.sharpImage === "fail") {
    warning = {
      title: "Image is Blurry",
      message:
        s.motion > 12
          ? "Hold your device steady — motion is blurring the image."
          : "Move slightly closer or farther until the text looks sharp.",
      tone: "warn",
    }
  } else if (checks.glare === "fail") {
    warning = {
      title: "Glare Detected",
      message: "Tilt the document slightly to reduce reflections.",
      tone: "warn",
    }
  } else if (checks.allCornersVisible === "fail") {
    warning = {
      title: "Corners Not Visible",
      message: "Fit the full document inside the frame — all four corners should show.",
      tone: "warn",
    }
  } else if (checks.alignment === "warn" || checks.alignment === "fail") {
    warning = {
      title: "Align the Document",
      message: "Center the ID and keep it flat within the frame.",
      tone: "warn",
    }
  } else if (checks.goodLighting === "warn") {
    warning = {
      title: "Lighting Could Be Better",
      message: "Improve lighting for a clearer scan.",
      tone: "warn",
    }
  }

  // Declared without initialisers: the branch chain below is exhaustive, so
  // any default here is dead and only invites the two copies drifting apart.
  let guideTitle: string
  let guideSubtitle: string
  let frameColor: DocumentQualityResult["frameColor"]

  if (phase === "searching") {
    guideTitle = "Place your document inside the frame"
    guideSubtitle = "Searching for document"
    frameColor = "blue"
  } else if (phase === "aligning") {
    guideTitle = "Auto Document Detection"
    guideSubtitle = "Aligning document"
    frameColor = warning?.tone === "error" ? "red" : "yellow"
  } else {
    guideTitle = "Perfect alignment detected"
    guideSubtitle = "Ready to capture"
    frameColor = "green"
  }

  return {
    metrics,
    checks,
    phase,
    guideTitle,
    guideSubtitle,
    warning,
    readyForCapture,
    frameColor,
    diagnostics: {
      meanLuma: Math.round(s.meanLuma),
      laplacianVar: Math.round(s.laplacianVar),
      borderScore: Math.round(s.borderScore),
      documentScore: Math.round(s.document),
      sideScores: s.sideScores.map((v) => Math.round(v)) as [number, number, number, number],
      glarePct: Math.round(s.glarePct * 10) / 10,
      motion: Math.round(s.motion * 10) / 10,
      sampleW: s.sampleW,
      sampleH: s.sampleH,
      minSide: Math.round(s.minSide),
      sideRange: Math.round(s.sideRange),
      rectScore: Math.round(s.rectScore),
    },
  }
}

/** One-shot helper (no temporal smoothing). Prefer DocumentQualityAnalyzer for live video. */
export function analyzeDocumentFrame(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
): DocumentQualityResult {
  const analyzer = new DocumentQualityAnalyzer()
  return analyzer.analyze(source)
}
