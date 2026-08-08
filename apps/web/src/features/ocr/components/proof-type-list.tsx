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
        <table className="w-full">
            <thead>
              <tr className="border-b border-card-line">
                <th className="pb-3 pl-5 pt-4 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Proof type
                </th>
                <th className="pb-3 pt-4 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Details
                </th>
                <th className="pb-3 pt-4 text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Available on sign-up
                </th>
                <th className="pb-3 pr-5 pt-4 text-right text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => {
                const displayName =
                  doc.template_name?.trim() || doc.name?.trim() || "Untitled proof"
                const available = doc.enabled !== false
                const sides = doc.required_sides ?? []
                const needsBoth = sides.includes("front") && sides.includes("back")

                return (
                  <tr key={doc.key} className="border-b border-card-line last:border-b-0">
                    <td className="py-4 pl-5">
                      <span className={cn("font-semibold", PROOF_THEME.title)}>{displayName}</span>
                    </td>
                    <td className="py-4">
                      <span className={cn("text-sm font-semibold", PROOF_THEME.muted)}>
                        {needsBoth ? "Front & back required" : "Front only"}
                        {doc.fields?.length
                          ? ` · ${doc.fields.length} field${doc.fields.length === 1 ? "" : "s"}`
                          : ""}
                      </span>
                    </td>
                    <td className="py-4">
                      <label className="inline-flex items-center gap-2">
                        <Switch
                          checked={available}
                          disabled={saving}
                          onCheckedChange={(enabled) => onToggleAvailable(doc.key, enabled)}
                        />
                        <span className={cn("text-xs font-semibold", PROOF_THEME.muted)}>
                          {available
                            ? "Residents can choose this proof"
                            : "Hidden until you turn this on"}
                        </span>
                      </label>
                    </td>
                    <td className="py-4 pr-5">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="font-bold text-white"
                          style={{ backgroundColor: PROOF_THEME.primary }}
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
                          className="font-bold text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setPendingRemoveKey(doc.key)}
                          disabled={saving || documents.length <= 1}
                        >
                          <Trash2 className="size-3.5" />
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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