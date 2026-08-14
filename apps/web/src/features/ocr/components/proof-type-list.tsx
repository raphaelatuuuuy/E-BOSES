import { useState } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"

import type { OcrDocumentType } from "@/features/ocr/api"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"

export function ProofTypeList(props: {
  documents: OcrDocumentType[]
  saving: boolean
  onAdd: () => void
  onEdit: (docKey: string) => void
  onRemove: (docKey: string) => void
  onToggleAvailable: (docKey: string, enabled: boolean) => void
}) {
  const { documents, saving, onAdd, onEdit, onRemove, onToggleAvailable } = props
  const [pendingRemoveKey, setPendingRemoveKey] = useState<string | null>(null)

  const pendingDoc = pendingRemoveKey
    ? documents.find((doc) => doc.key === pendingRemoveKey)
    : undefined
  const pendingName =
    pendingDoc?.template_name?.trim() ||
    pendingDoc?.name?.trim() ||
    pendingRemoveKey ||
    "this proof type"

  return (
    <div className="w-full space-y-6">
      {documents.length === 0 ? (
        <div className={cn(PROOF_THEME.card, "flex flex-col items-center gap-4 py-10 text-center")}>
          <div className="space-y-1">
            <h3 className={cn("text-lg font-semibold", PROOF_THEME.title)}>
              No proof types yet
            </h3>
            <p className={cn("font-semibold", PROOF_THEME.body)}>
              Add your first ID or document type for resident sign-up.
            </p>
          </div>
          <Button
            type="button"
            className={cn("font-bold text-white", PROOF_THEME.primaryBg)}
            onClick={onAdd}
            disabled={saving}
          >
            <Plus className="size-4" />
            Add your first proof type
          </Button>
        </div>
      ) : (
        /* A hairline list, not a four-column table: three of those columns were
           facts about one row, and the header row cost more than it explained. */
        <ul className="overflow-hidden rounded-xl border border-neutral-200">
          {documents.map((doc) => {
            const displayName =
              doc.template_name?.trim() || doc.name?.trim() || "Untitled proof"
            const available = doc.enabled !== false
            const sides = doc.required_sides ?? []
            const needsBoth = sides.includes("front") && sides.includes("back")
            const fieldCount = doc.fields?.length ?? 0

            return (
              <li
                key={doc.key}
                className="flex flex-wrap items-start gap-x-8 gap-y-4 border-b border-neutral-200 px-8 py-7 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-row text-foreground">{displayName}</p>
                  <p className="mt-1 text-meta text-neutral-500">
                    {needsBoth ? "Front and back required" : "Front only"}
                    {fieldCount
                      ? ` · ${fieldCount} field${fieldCount === 1 ? "" : "s"} read`
                      : " · no fields configured yet"}
                  </p>
                  <label className="mt-3 inline-flex items-center gap-3">
                    <Switch
                      checked={available}
                      disabled={saving}
                      onCheckedChange={(enabled) => onToggleAvailable(doc.key, enabled)}
                    />
                    <span className="text-meta text-neutral-500">
                      {available
                        ? "Residents can choose this proof"
                        : "Hidden until you turn this on"}
                    </span>
                  </label>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onEdit(doc.key)}
                    disabled={saving}
                  >
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setPendingRemoveKey(doc.key)}
                    disabled={saving || documents.length <= 1}
                  >
                    <Trash2 className="size-3.5" />
                    Remove
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog
        open={pendingRemoveKey != null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveKey(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className={PROOF_THEME.title}>Remove proof type?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className={cn("text-sm font-semibold leading-6", PROOF_THEME.body)}>
              Remove <strong className={PROOF_THEME.title}>“{pendingName}”</strong>? It will be
              removed from resident sign-up right away.
            </p>
          </DialogBody>
          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="font-bold hover:bg-tint hover:text-brand-blue"
              disabled={saving}
              onClick={() => setPendingRemoveKey(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="font-bold"
              disabled={saving || !pendingRemoveKey}
              onClick={() => {
                if (!pendingRemoveKey) return
                const key = pendingRemoveKey
                setPendingRemoveKey(null)
                onRemove(key)
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}