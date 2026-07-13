import { useRef, useState } from "react"
import {
  CheckCircle2,
  CloudUpload,
  FileText,
  Play,
  XCircle,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import type { OcrTestField, OcrTestResult } from "@/features/ocr/api"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"
import { FIELD_COLORS } from "@/features/ocr/lib/create-document-defaults"

function asPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—"
  const numeric = Number(value)
  return `${Math.round(numeric <= 1 ? numeric * 100 : numeric)}%`
}

export function TrySampleStep(props: {
  documentKey: string
  testRunning: boolean
  testFile: File | null
  testPreviewUrl: string | null
  testResult: OcrTestResult | null
  extractedList: OcrTestField[]
  onPickFile: (file: File) => void
  onRunAgain: () => void
}) {
  const {
    testRunning,
    testFile,
    testPreviewUrl,
    testResult,
    extractedList,
    onPickFile,
    onRunAgain,
  } = props

  const testInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const templateMatch = testResult?.template_match
  const overallConfidence = testResult?.overall_confidence ?? testResult?.confidence ?? null

  return (
    <section className={PROOF_THEME.card}>
      <div className="flex w-full items-center justify-between px-4 py-4 text-left md:px-5">
        <span className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-blue-50 text-[#145be7]">
            <FileText className="size-5" />
          </span>
          <span>
            <span className={cn("block text-base font-black", PROOF_THEME.title)}>
              Try with a sample photo
            </span>
            <span className={cn("mt-0.5 block text-xs font-semibold", PROOF_THEME.body)}>
              Upload a real or sample ID photo to see what the system reads before you publish.
            </span>
          </span>
        </span>
      </div>

      <div className="border-t border-[#dfe7f5] p-4 md:p-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(14rem,0.9fr)_minmax(0,1.2fr)_minmax(14rem,0.85fr)]">
          <div>
            <p className={cn("mb-2 text-xs font-black", PROOF_THEME.title)}>
              Upload a photo to test
            </p>
            <input
              ref={testInputRef}
              type="file"
              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (file) onPickFile(file)
              }}
            />
            <button
              type="button"
              onClick={() => testInputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragOver(false)
                const file = event.dataTransfer.files?.[0]
                if (file) onPickFile(file)
              }}
              className={cn(
                "flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-8 text-center transition",
                dragOver
                  ? "border-[#145be7] bg-blue-50"
                  : "border-[#cbd8ee] bg-[#f8fafc] hover:bg-white",
              )}
            >
              <CloudUpload className="size-7 text-[#145be7]" />
              <span className={cn("text-sm font-black", PROOF_THEME.title)}>
                {testRunning ? "Reading photo…" : "Drop a photo here"}
              </span>
              <span className={cn("text-xs font-semibold", PROOF_THEME.muted)}>
                JPG or PNG, up to 10MB
              </span>
              <span
                className={cn(
                  "mt-1 rounded-lg px-3 py-1.5 text-xs font-bold text-white",
                  PROOF_THEME.primaryBg,
                )}
              >
                Choose photo
              </span>
            </button>
            {testPreviewUrl ? (
              <div className="mt-3 overflow-hidden rounded-xl border border-[#dfe7f5]">
                <img
                  src={testPreviewUrl}
                  alt="Test preview"
                  className="max-h-36 w-full bg-white object-contain"
                />
                <div
                  className={cn(
                    "flex items-center justify-between gap-2 border-t border-[#dfe7f5] px-2.5 py-1.5 text-[11px] font-semibold",
                    PROOF_THEME.muted,
                  )}
                >
                  <span className="truncate">{testFile?.name}</span>
                  {testFile ? <span>{Math.round(testFile.size / 1024)} kB</span> : null}
                </div>
              </div>
            ) : null}
          </div>

          <div>
            <p className={cn("mb-2 text-xs font-black", PROOF_THEME.title)}>What was found</p>
            <div className="overflow-hidden rounded-xl border border-[#dfe7f5]">
              <table className="w-full text-left text-sm">
                <thead className={cn("bg-[#f2f6ff] text-xs font-bold", PROOF_THEME.muted)}>
                  <tr>
                    <th className="px-3 py-2.5">Information</th>
                    <th className="px-3 py-2.5">Value found</th>
                    <th className="px-3 py-2.5 text-right">Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {extractedList.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className={cn(
                          "px-3 py-10 text-center text-xs font-semibold",
                          PROOF_THEME.muted,
                        )}
                      >
                        Run a test to see what the system reads from your boxes.
                      </td>
                    </tr>
                  ) : (
                    extractedList.map((field, index) => (
                      <tr key={field.key} className="border-t border-[#dfe7f5]">
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-2 font-semibold">
                            <span
                              className="flex size-5 items-center justify-center rounded text-[10px] font-bold text-white"
                              style={{
                                backgroundColor: FIELD_COLORS[index % FIELD_COLORS.length],
                              }}
                            >
                              {index + 1}
                            </span>
                            {field.label}
                          </span>
                        </td>
                        <td className={cn("px-3 py-2.5 font-black", PROOF_THEME.title)}>
                          {field.value || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-black text-emerald-600">
                          {asPercent(field.confidence)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <details className="rounded-xl border border-[#dfe7f5] bg-[#f8fafc] p-3">
              <summary className={cn("cursor-pointer text-xs font-black", PROOF_THEME.muted)}>
                Technical details (optional)
              </summary>
              <pre className="mt-3 max-h-56 overflow-auto rounded-xl border border-[#1e293b] bg-[#0b1220] p-3 text-[11px] leading-5 text-emerald-300">
                {JSON.stringify(
                  testResult?.extraction_json ||
                    Object.fromEntries(extractedList.map((item) => [item.key, item.value])),
                  null,
                  2,
                )}
              </pre>
            </details>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-[#dfe7f5] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm font-semibold">
            {templateMatch?.passed ? (
              <span className="inline-flex items-center gap-1.5 font-black text-emerald-700">
                <CheckCircle2 className="size-4" /> Document looks valid
              </span>
            ) : testResult ? (
              <span className="inline-flex items-center gap-1.5 font-black text-amber-700">
                <XCircle className="size-4" /> Needs a closer look
              </span>
            ) : (
              <span className={PROOF_THEME.muted}>Run a test to check this proof type.</span>
            )}
            <span className={PROOF_THEME.muted}>
              Overall reading quality{" "}
              <strong className={PROOF_THEME.title}>{asPercent(overallConfidence)}</strong>
            </span>
          </div>
          <Button
            className={cn("font-bold text-white", PROOF_THEME.primaryBg)}
            disabled={testRunning || !testFile}
            onClick={onRunAgain}
          >
            <Play className="size-4" />
            {testRunning ? "Reading…" : "Try again"}
          </Button>
        </div>
      </div>
    </section>
  )
}
