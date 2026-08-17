import { useState } from "react"
import { Plus } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import type { OcrDocumentType } from "@/features/ocr/api"
import {
  SheetDialog,
  SheetPrimaryButton,
} from "@/features/dashboard/components/sheet-dialog"
import { Pager, PAGE_SIZE } from "@/components/ui/list-controls"

export function ProofTypeList(props: {
  documents: OcrDocumentType[]
  saving: boolean
  onAdd: () => void
  onEdit: (docKey: string) => void
  onRemove: (docKey: string) => void
}) {
  const { documents, saving, onAdd, onEdit, onRemove } = props
  const [pendingRemoveKey, setPendingRemoveKey] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const visible = documents.slice(offset, offset + PAGE_SIZE)

  const pendingDoc = pendingRemoveKey
    ? documents.find((doc) => doc.key === pendingRemoveKey)
    : undefined
  const pendingName =
    pendingDoc?.template_name?.trim() ||
    pendingDoc?.name?.trim() ||
    pendingRemoveKey ||
    "this proof type"

  return (
    <div className="w-full">
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
            disabled={saving}
            className="rounded-full font-bold"
          >
            <Plus className="size-4" />
            Add a document
          </Button>
        </div>
      ) : (
        /* Editorial rows, not stacked cards: a left rail carrying whether the
           proof is live, a strong name, and its facts as labelled pairs. Ten at
           a time — a list of every proof type is not more useful, just longer. */
        <>
          <ol>
            {visible.map((doc) => {
              const displayName =
                doc.template_name?.trim() ||
                doc.name?.trim() ||
                "Untitled proof"
              const available = doc.enabled !== false
              const sides = doc.required_sides ?? []
              const needsBoth =
                sides.includes("front") && sides.includes("back")
              const fieldCount = doc.fields?.length ?? 0

              return (
                <li
                  key={doc.key}
                  className="grid grid-cols-1 gap-x-8 gap-y-3 border-b border-neutral-200 py-6 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <p className="text-row text-brand-navy">{displayName}</p>
                    <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                      <div>
                        <dt className="text-meta text-neutral-400">
                          Status
                        </dt>
                        <dd className="mt-0.5 text-meta text-brand-navy">
                          {available ? "Visible on sign-up" : "Hidden"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-meta text-neutral-400">
                          Photos needed
                        </dt>
                        <dd className="mt-0.5 text-meta text-brand-navy">
                          {needsBoth ? "Front and back" : "Front only"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-meta text-neutral-400">
                          Details read
                        </dt>
                        <dd className="mt-0.5 text-meta text-brand-navy">
                          {fieldCount
                            ? `${fieldCount} field${fieldCount === 1 ? "" : "s"}`
                            : "None set up yet"}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex shrink-0 items-center gap-5 border-t border-neutral-200 pt-3 sm:border-0 sm:pt-0">
                    <button
                      type="button"
                      onClick={() => onEdit(doc.key)}
                      disabled={saving}
                      className="text-meta text-neutral-500 transition-colors hover:text-accent disabled:text-neutral-300"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingRemoveKey(doc.key)}
                      disabled={saving || documents.length <= 1}
                      className="text-meta text-neutral-500 transition-colors hover:text-sos disabled:text-neutral-300"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
          <Pager
            offset={offset}
            total={documents.length}
            onChange={setOffset}
            noun="proof types"
          />
        </>
      )}

      {/* The product's own dialog, the same one Settings, Profile and the
          report flow use. This was a bare DialogContent with its own footer
          layout, so removing a proof type looked like a different app. */}
      <SheetDialog
        open={pendingRemoveKey != null}
        onClose={() => setPendingRemoveKey(null)}
        title="Remove this proof type?"
        description={
          <>
            Residents will stop seeing <strong>“{pendingName}”</strong> on
            sign-up straight away. Checks already completed with it are kept.
          </>
        }
        footer={
          /* Stacked and full width, the way every other confirmation in the
             product ends: the destructive action first, then the neutral way
             out — the same button Settings uses to sign out. */
          <div className="space-y-3">
            <SheetPrimaryButton
              tone="danger"
              disabled={saving || !pendingRemoveKey}
              onClick={() => {
                if (!pendingRemoveKey) return
                const key = pendingRemoveKey
                setPendingRemoveKey(null)
                onRemove(key)
              }}
            >
              Remove
            </SheetPrimaryButton>
            <SheetPrimaryButton
              disabled={saving}
              onClick={() => setPendingRemoveKey(null)}
            >
              Keep it
            </SheetPrimaryButton>
          </div>
        }
      />
    </div>
  )
}
