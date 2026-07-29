import { useState } from "react"
import { Info, Pencil, Plus, Trash2 } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
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
import {
  deriveProofStatus,
  proofStatusLabel,
  type ProofListStatus,
} from "@/features/ocr/lib/proof-status"
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

  // Zero types with enabled !== false → none are live on resident sign-up.
  const noLiveTypes = !documents.some((doc) => doc.enabled !== false)

  return (
    <div className="w-full space-y-6">
      {noLiveTypes ? (
        <div
          role="status"
          className="flex gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold leading-6 text-[#145be7]"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            No proof types are live on sign-up yet. Turn on{" "}
            <strong className="font-black">Available on sign-up</strong> when a type is ready.
          </p>
        </div>
      ) : null}

      {documents.length === 0 ? (
        <div className={cn(PROOF_THEME.card, "flex flex-col items-center gap-4 py-10 text-center")}>
          <div className="space-y-1">
            <h3 className={cn("text-lg font-black", PROOF_THEME.title)}>
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
                const status = deriveProofStatus(doc)
                const displayName =
                  doc.template_name?.trim() || doc.name?.trim() || "Untitled proof"
                const available = doc.enabled !== false
                const sides = doc.required_sides ?? []
                const needsBoth = sides.includes("front") && sides.includes("back")

                return (
                  <tr key={doc.key} className="border-b border-card-line last:border-b-0">
                    <td className="py-4 pl-5">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-[#07145f]">{displayName}</span>
                        <StatusBadge status={status} />
                      </div>
                    </td>
                    <td className="py-4">
                      <span className="text-sm font-semibold text-[#68739c]">
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
                        <span className="text-xs font-semibold text-[#68739c]">
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
                          style={{ backgroundColor: "#145be7" }}
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
              className="font-bold"
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

function StatusBadge({ status }: { status: ProofListStatus }) {
  const styles: Record<ProofListStatus, string> = {
    live: "border-emerald-200 bg-emerald-50 text-emerald-800",
    hidden: "border-amber-200 bg-amber-50 text-amber-800",
    needs_setup: "border-slate-200 bg-slate-50 text-slate-700",
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 font-bold ring-0 hover:bg-inherit",
        styles[status],
      )}
    >
      {proofStatusLabel(status)}
    </Badge>
  )
}
