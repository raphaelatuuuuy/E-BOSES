import type { OcrDocumentType, OcrTestField, ProofSide } from "@/features/ocr/api"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"
import {
  fieldDisplayColor,
  fieldDisplayNumber,
} from "@/features/ocr/lib/create-document-defaults"
import { cn } from "@workspace/ui/lib/utils"

function asPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return "—"
  const numeric = Number(value)
  return `${Math.round(numeric <= 1 ? numeric * 100 : numeric)}%`
}

interface ExtractedTableProps {
  extractedList: OcrTestField[]
  documentFields: OcrDocumentType["fields"]
  testedSide?: ProofSide | null
  hasTestSource: boolean
}

export function ExtractedTable({
  extractedList,
  documentFields = [],
  testedSide,
  hasTestSource,
}: ExtractedTableProps) {
  return (
    <div>
      <p className={cn("mb-2 text-xs font-black", PROOF_THEME.title)}>
        What was found
        {testedSide === "front" || testedSide === "back" ? (
          <span className={cn("ml-2 text-[11px] font-semibold", PROOF_THEME.muted)}>
            ({testedSide === "front" ? "Front" : testedSide === "back" ? "Back" : "Sample"} fields only)
          </span>
        ) : null}
      </p>
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
                  {hasTestSource
                    ? "Press Test or Run test to see what the system reads."
                    : "Upload a sample in Mark areas, or choose a photo here."}
                </td>
              </tr>
            ) : (
              extractedList.map((field) => {
                const def = documentFields.find((item) => item.key === field.key)
                const displayNumber = def
                  ? fieldDisplayNumber(def, documentFields)
                  : 0
                const color = def
                  ? fieldDisplayColor(def, documentFields)
                  : "#2563eb"
                return (
                <tr key={field.key} className="border-t border-[#dfe7f5]">
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-2 font-semibold">
                      <span
                        className="flex size-5 items-center justify-center rounded text-[10px] font-bold text-white"
                        style={{
                          backgroundColor: color,
                        }}
                      >
                        {displayNumber || "·"}
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
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
