import { useMemo } from "react"
import { FileCheck2, Files, ShieldCheck } from "lucide-react"
import { useSearchParams } from "react-router-dom"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import OcrTemplateBuilderPage from "@/features/ocr/ocr-template-builder-page"
import VerificationQueuePage from "@/features/ocr/verification-queue-page"
import { usePageTitle } from "@/hooks/use-page-title"

type IdProofTab = "templates" | "queue"

const tabs: Array<{
  id: IdProofTab
  label: string
  description: string
  icon: typeof Files
}> = [
  {
    id: "templates",
    label: "ID & Proof Templates",
    description: "Configure proof types, capture areas, rules, and signup availability.",
    icon: Files,
  },
  {
    id: "queue",
    label: "Verification Queue",
    description: "Review OCR edge cases, protected proof media, and final account decisions.",
    icon: FileCheck2,
  },
]

function normalizeTab(value: string | null): IdProofTab {
  return value === "queue" ? "queue" : "templates"
}

export default function OfficialIdProofWorkspacePage() {
  usePageTitle("ID & Proof Configuration")
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = normalizeTab(searchParams.get("tab"))

  const activeDescription = useMemo(
    () => tabs.find((item) => item.id === activeTab)?.description ?? tabs[0].description,
    [activeTab],
  )

  function switchTab(next: IdProofTab) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current)
      params.set("tab", next)
      return params
    })
  }

  return (
    <main className="min-h-full bg-[#f6f8ff]">
      <section className="border-b border-[#dce5f8] bg-white/90 px-4 py-5 backdrop-blur md:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.28em] text-[#ff6a1a]">
                Official Configuration
              </p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-[#07145f] sm:text-3xl">
                ID & Proof workspace
              </h1>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#43507f]">
                {activeDescription}
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-2xl border border-[#dce5f8] bg-[#f8fbff] px-3 py-2 text-sm font-black text-[#07145f] shadow-sm">
              <ShieldCheck className="size-4 text-[#22a06b]" />
              OCR + official review
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto rounded-2xl border border-[#dce5f8] bg-[#f8fbff] p-1">
            {tabs.map((item) => {
              const Icon = item.icon
              const active = activeTab === item.id
              return (
                <Button
                  key={item.id}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-auto shrink-0 rounded-lg px-4 py-3 text-left text-sm font-black",
                    active
                      ? "bg-white text-[#07145f] shadow-sm ring-1 ring-[#dce5f8]"
                      : "text-[#68739c] hover:bg-white/70 hover:text-[#07145f]",
                  )}
                  onClick={() => switchTab(item.id)}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Button>
              )
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl">
        {activeTab === "templates" ? <OcrTemplateBuilderPage /> : <VerificationQueuePage />}
      </section>
    </main>
  )
}
