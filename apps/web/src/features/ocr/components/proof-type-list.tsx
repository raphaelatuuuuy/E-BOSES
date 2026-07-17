import { useState } from "react"
import { Info, Pencil, Plus, Trash2 } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
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
    <div className="mx-auto w-full max-w-[1200px] space-y-6 p-4 md:p-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className={cn("text-2xl font-black md:text-3xl", PROOF_THEME.title)}>
            ID &amp; Proof Templates
          </h1>
          <p className={cn("mt-2 max-w-2xl text-sm font-semibold leading-6", PROOF_THEME.body)}>
            Choose which IDs and documents residents can submit when signing up. Set up each proof
            type, then turn on availability when it is ready.
          </p>
        </div>
        <Button
          type="button"
          className={cn("shrink-0 font-bold text-white", PROOF_THEME.primaryBg)}
          onClick={onAdd}
          disabled={saving}
        >
          <Plus className="size-4" />
          Add proof type
        </Button>
      </header>

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
        <Card className={cn(PROOF_THEME.card, "gap-4 py-10")}>
          <CardHeader className="items-center text-center">
            <CardTitle className={cn("text-lg font-black", PROOF_THEME.title)}>
              No proof types yet
            </CardTitle>
            <CardDescription className={cn("font-semibold", PROOF_THEME.body)}>
              Add your first ID or document type for resident sign-up.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button
              type="button"
              className={cn("font-bold text-white", PROOF_THEME.primaryBg)}
              onClick={onAdd}
              disabled={saving}
            >
              <Plus className="size-4" />
              Add your first proof type
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {documents.map((doc) => {
            const status = deriveProofStatus(doc)
            const displayName =
              doc.template_name?.trim() || doc.name?.trim() || "Untitled proof"
            const available = doc.enabled !== false
            const sides = doc.required_sides ?? []
            const needsBoth = sides.includes("front") && sides.includes("back")

            return (
              <Card
                key={doc.key}
                className={cn(PROOF_THEME.card, "gap-0 py-0 transition hover:shadow-md")}
              >
                <CardHeader className="gap-3 space-y-0 px-5 pt-5 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle
                      className={cn("line-clamp-2 text-base font-black leading-snug", PROOF_THEME.title)}
                    >
                      {displayName}
                    </CardTitle>
                    <StatusBadge status={status} />
                  </div>
                  <p className={cn("text-xs font-semibold", PROOF_THEME.muted)}>
                    {needsBoth ? "Front & back required" : "Front only"}
                    {doc.fields?.length
                      ? ` · ${doc.fields.length} field${doc.fields.length === 1 ? "" : "s"}`
                      : ""}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4 px-5 pb-5">
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-[#dfe7f5] bg-[#f8fafc] px-3 py-2.5">
                    <span className="min-w-0">
                      <span className={cn("block text-xs font-black", PROOF_THEME.title)}>
                        Available on sign-up
                      </span>
                      <span className={cn("mt-0.5 block text-[11px] font-semibold", PROOF_THEME.muted)}>
                        {available
                          ? "Residents can choose this proof"
                          : "Hidden until you turn this on"}
                      </span>
                    </span>
                    <Switch
                      checked={available}
                      disabled={saving}
                      onCheckedChange={(enabled) => onToggleAvailable(doc.key, enabled)}
                    />
                  </label>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className={cn("flex-1 font-bold text-white", PROOF_THEME.primaryBg)}
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
                </CardContent>
              </Card>
            )
          })}
        </div>
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
