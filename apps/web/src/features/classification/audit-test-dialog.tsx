import { useEffect, useState } from "react"
import { ArrowLeftIcon, ChevronRightIcon, FileWarningIcon, IdCardIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { SheetDialog } from "@/features/dashboard/components/sheet-dialog"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { getConcernClassificationConfig, type ConcernClassificationConfig } from "./api"
import { ConcernTestWorkspace } from "./test-workspace-concerns"
import { VerificationTestWorkspace } from "./test-workspace-verification"

type Workspace = "menu" | "concerns" | "verification"

export function AuditTestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [workspace, setWorkspace] = useState<Workspace>("menu")
  const [config, setConfig] = useState<ConcernClassificationConfig | null>(null)

  useEffect(() => {
    if (!open || config) return
    void getConcernClassificationConfig()
      .then(setConfig)
      .catch((error) => toast.error(describeApiError(error, "Could not load the automated checks.")))
  }, [open, config])

  function close() {
    setWorkspace("menu")
    onClose()
  }

  const title = workspace === "menu" ? "Test automated checks" : workspace === "concerns" ? "Test concerns" : "Test an ID document"
  const description = workspace === "menu"
    ? "Run a sample through the current automated system. Tests do not create reports, emergencies, accounts, or audit events."
    : "Test only. Nothing here is filed or changed."

  return (
    <SheetDialog
      open={open}
      onClose={close}
      onBack={workspace === "menu" ? undefined : () => setWorkspace("menu")}
      title={title}
      description={description}
      size="wide"
    >
      {workspace === "menu" ? (
        <div className="divide-y divide-neutral-200 border-y border-neutral-200">
          <TestChoice
            icon={FileWarningIcon}
            title="Concerns"
            description="Test the same image, description, location, and automated checks used by the resident report dialog."
            onClick={() => setWorkspace("concerns")}
          />
          <TestChoice
            icon={IdCardIcon}
            title="ID Document"
            description="Test OCR, required fields, document layout, authenticity, and the resulting verification decision."
            onClick={() => setWorkspace("verification")}
          />
        </div>
      ) : !config ? (
        <div className="flex justify-center py-16"><LoaderCircleIcon className="size-6 animate-spin text-brand-navy" /></div>
      ) : workspace === "verification" ? (
        <VerificationTestWorkspace />
      ) : <ConcernTestWorkspace config={config} />}
    </SheetDialog>
  )
}

function TestChoice({ icon: Icon, title, description, onClick }: {
  icon: typeof ArrowLeftIcon
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group grid w-full grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-4 py-6 text-left transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-brand-navy focus-visible:ring-offset-2 focus-visible:outline-none active:translate-y-px"
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-brand-navy text-white transition-colors group-hover:bg-accent">
        <Icon className="size-6" strokeWidth={1.7} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-row font-semibold text-brand-navy group-hover:text-accent">{title}</span>
        <span className="mt-1 block max-w-xl text-meta leading-relaxed text-neutral-500">{description}</span>
      </span>
      <ChevronRightIcon className="size-5 text-neutral-300 transition-transform group-hover:translate-x-1 group-hover:text-accent" aria-hidden />
    </button>
  )
}
