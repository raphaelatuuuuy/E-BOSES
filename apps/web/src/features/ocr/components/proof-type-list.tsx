import { useState } from "react"
import { PencilIcon, Plus } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import type { OcrDocumentType } from "@/features/ocr/api"
import {
  SheetIconButton,
} from "@/features/dashboard/components/sheet-dialog"
import { PAGE_SIZE } from "@/components/ui/list-controls"
import { ConfigurationListToolbar, ConfigurationPager } from "@/features/dashboard/components/config/configuration-list-controls"
import { ConfigurationTable, ConfigurationTableRow } from "@/features/dashboard/components/config/configuration-table"

export function ProofTypeList(props: {
  documents: OcrDocumentType[]
  onAdd: () => void
  onEdit: (docKey: string) => void
}) {
  const { documents, onAdd, onEdit } = props
  const [offset, setOffset] = useState(0)
  const [query, setQuery] = useState("")
  const [sideFilter, setSideFilter] = useState("all")
  const filtered = documents.filter((doc) => {
    const q = query.trim().toLowerCase()
    if (q && !`${doc.template_name ?? ""} ${doc.name ?? ""}`.toLowerCase().includes(q)) return false
    if (sideFilter === "all") return true
    const sides = doc.required_sides ?? []
    const both = sides.includes("front") && sides.includes("back")
    if (sideFilter === "front") return !both
    return both
  })
  const visible = filtered.slice(offset, offset + PAGE_SIZE)

  return (
    <div className="w-full">
      <div className="space-y-4">
      <ConfigurationListToolbar
        search={query}
        onSearch={(value) => { setQuery(value); setOffset(0) }}
        placeholder="Search proof types"
        filters={[{ key: "all", label: "All", count: documents.length }, { key: "front", label: "Front", count: documents.filter((doc) => { const sides = doc.required_sides ?? []; return !(sides.includes("front") && sides.includes("back")) }).length }, { key: "both", label: "Front and back", count: documents.filter((doc) => { const sides = doc.required_sides ?? []; return sides.includes("front") && sides.includes("back") }).length }, { key: "__add", label: "Add a proof" }]}
        activeFilter={sideFilter}
        onFilter={(value) => { if (value === "__add") { onAdd(); return } setSideFilter(value); setOffset(0) }}
      />
      <div>
      {documents.length === 0 ? (
        <div className="flex flex-col items-start gap-4 border-t border-neutral-200 py-12">
          <div className="space-y-1">
            <h3 className="text-section text-brand-navy">No documents yet</h3>
            <p className="mt-2 text-read text-neutral-500">
              Add the first ID or document residents can use to prove they live
              here.
            </p>
          </div>
          <Button
            type="button"
            onClick={onAdd}
            className="rounded-full font-bold"
          >
            <Plus className="size-4" />
            Add a document
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-read text-neutral-500">No proof types match your search.</p>
      ) : (
        <>
          <ConfigurationTable label="Proof types" hideHeader>
            {visible.map((doc) => {
              const displayName =
                doc.template_name?.trim() ||
                doc.name?.trim() ||
                "Untitled proof"
              const available = doc.enabled !== false
              const sides = doc.required_sides ?? []
              const needsBoth =
                sides.includes("front") && sides.includes("back")

              return (
                <ConfigurationTableRow
                  key={doc.key}
                  actions={<SheetIconButton label={`Edit ${displayName}`} onClick={() => onEdit(doc.key)} className="mr-1 size-8 text-neutral-400 hover:text-neutral-700">
                    <PencilIcon className="size-5" strokeWidth={1.9} aria-hidden />
                  </SheetIconButton>}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="min-w-0 flex-1 break-words text-[15px] leading-snug font-bold text-neutral-900">{displayName}</p>
                      <span className="shrink-0 text-[13px] text-neutral-400">{needsBoth ? "Front and back" : "Front only"}</span>
                    </div>
                    <p className="mt-1 text-[13px] text-neutral-500">{available ? "Visible on sign-up" : "Hidden"}</p>
                  </div>
                </ConfigurationTableRow>
              )
            })}
          </ConfigurationTable>
          <ConfigurationPager key={offset} offset={offset} total={filtered.length} pageSize={PAGE_SIZE} onChange={setOffset} noun="proof types" className="py-1" inline />
        </>
          )}
      </div>
      </div>

    </div>
  )
}
