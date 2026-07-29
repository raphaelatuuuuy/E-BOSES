/**
 * Normalize gallery / camera photos before upload:
 * - Decode browser-supported images (JPEG/PNG/WebP)
 * - Mild contrast + sharpen for OCR (without cropping)
 * - Resize huge phone photos; re-encode as high-quality JPEG
 */

const MAX_EDGE = 2000
const MIN_EDGE = 1000
const TARGET_BYTES = 2.2 * 1024 * 1024
const HARD_MAX_BYTES = 10 * 1024 * 1024

export type PrepareProofResult =
  | { ok: true; file: File; compressed: boolean; message?: string }
  | { ok: false; message: string }

function isProbablyImage(file: File) {
  if (file.type.startsWith("image/")) return true
  const ext = file.name.split(".").pop()?.toLowerCase() || ""
  return ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif", "bmp"].includes(ext)
}

async function loadImageBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file)
    } catch {
      // fall through to HTMLImageElement
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error("decode failed"))
      el.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
}

/**
 * Mild OCR-friendly enhance in canvas (geometry unchanged):
 * contrast + slight brightness + unsharp-like pass.
 */
function enhanceCanvas(ctx: CanvasRenderingContext2D, width: number, height: number) {
  // Contrast / brightness via CSS filter composite draw is not available mid-buffer;
  // use pixel path for reliability on mobile.
  const image = ctx.getImageData(0, 0, width, height)
  const data = image.data
  const contrast = 1.18
  const brightness = 6
  const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255))

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const v = data[i + c]!
      const out = factor * (v - 128) + 128 + brightness
      data[i + c] = Math.max(0, Math.min(255, out))
    }
  }
  ctx.putImageData(image, 0, 0)

  // Simple unsharp: draw a blurred copy underneath and composite (approx).
  // Canvas blur is limited; skip if createImageBitmap path fails — contrast alone helps.
  try {
    const soft = document.createElement("canvas")
    soft.width = width
    soft.height = height
    const sctx = soft.getContext("2d")
    if (sctx) {
      sctx.filter = "blur(0.6px)"
      sctx.drawImage(ctx.canvas, 0, 0)
      sctx.filter = "none"
      const sharp = ctx.getImageData(0, 0, width, height)
      const blurred = sctx.getImageData(0, 0, width, height)
      const sd = sharp.data
      const bd = blurred.data
      const amount = 0.55
      for (let i = 0; i < sd.length; i += 4) {
        for (let c = 0; c < 3; c += 1) {
          const v = sd[i + c]! + amount * (sd[i + c]! - bd[i + c]!)
          sd[i + c] = Math.max(0, Math.min(255, v))
        }
      }
      ctx.putImageData(sharp, 0, 0)
    }
  } catch {
    // Unsharp optional
  }
}

/**
 * Prepare a user-selected proof image for upload.
 * Always returns an enhanced .jpg File when successful.
 */
export async function prepareProofImage(
  file: File,
  onProgress?: (message: string) => void,
): Promise<PrepareProofResult> {
  if (!file || file.size <= 0) {
    return { ok: false, message: "That file is empty. Choose a photo of your ID." }
  }

  if (!isProbablyImage(file)) {
    return {
      ok: false,
      message: "Please choose a photo (JPG or PNG). PDF and HEIC may not work on this browser.",
    }
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || ""
  if (ext === "heic" || ext === "heif" || file.type === "image/heic" || file.type === "image/heif") {
    return {
      ok: false,
      message:
        "HEIC photos are not supported. In your phone camera settings, switch to Most Compatible (JPEG), or export the photo as JPG.",
    }
  }

  if (file.size > HARD_MAX_BYTES) {
    return {
      ok: false,
      message: "Photo is too large (over 10 MB). Choose a smaller photo or take a new one.",
    }
  }

  onProgress?.("Improving photo for reading…")

  let source: ImageBitmap | HTMLImageElement
  try {
    source = await loadImageBitmap(file)
  } catch {
    return {
      ok: false,
      message:
        "Could not read that image. Use a JPG or PNG photo of your document (not HEIC or PDF).",
    }
  }

  const srcW = "naturalWidth" in source ? source.naturalWidth || source.width : source.width
  const srcH = "naturalHeight" in source ? source.naturalHeight || source.height : source.height
  if (!srcW || !srcH) {
    if ("close" in source && typeof source.close === "function") source.close()
    return { ok: false, message: "Could not read image dimensions. Try another photo." }
  }

  // Scale: cap huge images, upscale small ones for OCR
  const maxSide = Math.max(srcW, srcH)
  const minSide = Math.min(srcW, srcH)
  let scale = 1
  if (maxSide > MAX_EDGE) scale = MAX_EDGE / maxSide
  else if (minSide < MIN_EDGE) scale = Math.min(2.2, MIN_EDGE / minSide)

  const width = Math.max(1, Math.round(srcW * scale))
  const height = Math.max(1, Math.round(srcH * scale))

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) {
    if ("close" in source && typeof source.close === "function") source.close()
    return { ok: false, message: "Could not process the image on this device." }
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height)
  if ("close" in source && typeof source.close === "function") source.close()

  enhanceCanvas(ctx, width, height)

  onProgress?.("Compressing photo…")

  // Prefer higher JPEG quality so text stays crisp for server OCR
  let quality = 0.92
  let blob = await canvasToBlob(canvas, quality)
  while (blob && blob.size > TARGET_BYTES && quality > 0.72) {
    quality -= 0.05
    blob = await canvasToBlob(canvas, quality)
  }

  if (!blob) {
    return { ok: false, message: "Could not compress the photo. Try another image." }
  }

  if (blob.size > HARD_MAX_BYTES) {
    return {
      ok: false,
      message: "Photo is still too large after compression. Take a closer photo of the ID only.",
    }
  }

  const outName = `proof-${Date.now()}.jpg`
  const outFile = new File([blob], outName, { type: "image/jpeg", lastModified: Date.now() })
  return {
    ok: true,
    file: outFile,
    compressed: true,
    message:
      file.size > TARGET_BYTES
        ? `Photo optimized (${Math.round(file.size / 1024)} KB → ${Math.round(outFile.size / 1024)} KB)`
        : "Photo enhanced for clearer text reading",
  }
}
