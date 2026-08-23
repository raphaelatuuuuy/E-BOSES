import { forwardRef, useImperativeHandle, useState } from "react"
import {
  ArrowLeft,
  CreditCard,
  Eye,
  EyeOff,
  IdCard,
  LoaderCircle,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { usePageTitle } from "@/hooks/use-page-title"
import type { ProofSide } from "@/features/ocr/api"
import { ProofWizardShell } from "@/features/ocr/components/wizard-shell"
import { ProofWorkspace } from "@/features/ocr/components/proof-workspace"
import { ProofTypeList } from "@/features/ocr/components/proof-type-list"
import { RulesStep } from "@/features/ocr/components/steps/rules-step"
import {
  TrySampleProfileForm,
  TrySampleResults,
} from "@/features/ocr/components/steps/try-sample-step"
import type { ProfileMatchKey } from "@/features/ocr/hooks/use-ocr-template-state"
import { useOcrTemplateState } from "@/features/ocr/hooks/use-ocr-template-state"

const OcrTemplateBuilderPage = forwardRef<
  { startAddProofType: () => void },
  object
>(function OcrTemplateBuilderPage(_props, ref) {
  usePageTitle("ID & Proof Templates")
  const [view, setView] = useState<"list" | "wizard">("list")
  const [edited, setEdited] = useState(false)

  const {
    configuration,
    loading,
    saving,
    autoSaveState,
    error,
    selectedDocument,
    beginEditingDocument,
    selectedField,
    fields,
    updateSelectedDocument,
    updateField,
    updateFieldHints,
    saveProofNameAndDescription,
    setProofAvailableOnSignup,
    persistWizardExit,
    addDocumentType,
    removeDocumentType,
    changeCaptureMode,
    canvasSides,
    fieldMatchProfiles,
    fieldHasNotExpired,
    setFieldValidationRules,
    addField,
    removeField,
    renameField,
    selectField,
    setFieldRegion,
    samplePreviewSide,
    setSamplePreviewSide,
    handleSampleUpload,
    handleSampleRemove,
    zoom,
    sortedCanvasFields,
    selectedFieldIndex,
    canvasSource,
    testSlots,
    mergedTestResult,
    testRunning,
    runningTestKey,
    runTestAll,
    uploadTestSlot,
    clearTestSlot,
    sampleMatchForSide,
    resetTests,
    testProfile,
    setTestProfileField,
    relevantProfileKeys,
    validateRequiredSamples,
    missingRequiredSampleSides,
  } = useOcrTemplateState()

  useImperativeHandle(ref, () => ({
    startAddProofType() {
      void addDocumentType()
      setEdited(false)
      setView("wizard")
    },
  }))

  const missingSamples = missingRequiredSampleSides(selectedDocument)
  const missingSampleLabels = missingSamples.map((side) =>
    side === "front" ? "Front" : side === "back" ? "Back" : "Sample"
  )

  // Values last read for each detail from the most recent test, so rows can
  // show a green check or "Not tested" without opening anything.
  const lastReadByKey = new Map<string, string>()
  for (const side of Object.keys(mergedTestResult.bySide ?? {})) {
    const result = mergedTestResult.bySide?.[side as ProofSide]
    const extracted = result?.extracted_fields
    if (Array.isArray(extracted)) {
      for (const field of extracted) {
        if ((field.value ?? "").trim())
          lastReadByKey.set(field.key, field.value)
      }
    }
  }

  function changeFieldMatches(fieldKey: string, next: ProfileMatchKey[]) {
    const field = fields.find((item) => item.key === fieldKey)
    setFieldValidationRules(fieldKey, {
      required: field?.required ?? false,
      matchProfiles: next,
      notExpired: fieldHasNotExpired(fieldKey),
    })
    setEdited(true)
  }

  async function backToList() {
    await persistWizardExit()
    // `setStep(1)` used to live here. It referenced state that no longer
    // exists — the wizard became a set of always-rendered accordion sections
    // (ProofEditorSection), so there is no step cursor to reset. As written it
    // was a ReferenceError on every use of this button.
    setView("list")
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] flex-col">
        <div className="flex flex-1 items-center justify-center gap-3">
          <LoaderCircle className="size-6 animate-spin text-neutral-400" />
          <span className="text-read text-neutral-500">Loading documents…</span>
        </div>
      </div>
    )
  }

  if (!configuration) {
    return (
      <div className="flex min-h-full flex-col">
        <div className="py-10 text-read text-sos" role="alert">
          {error || "Proof templates are unavailable right now."}
        </div>
      </div>
    )
  }

  if (view === "list") {
    return (
      <ProofTypeList
        documents={configuration.document_types}
        saving={saving}
        onAdd={() => {
          void addDocumentType()
          setEdited(false)
          setView("wizard")
        }}
        onEdit={(docKey) => {
          beginEditingDocument(docKey)
          resetTests()
          setEdited(false)
          setView("wizard")
        }}
        onRemove={(docKey) => {
          void removeDocumentType(docKey)
        }}
      />
    )
  }

  if (!selectedDocument) {
    return (
      <div className="flex min-h-full flex-col">
        <div className="space-y-4 py-10 text-read text-sos" role="alert">
          <p>{error || "Select a proof type to continue setup."}</p>
          <Button
            type="button"
            variant="outline"
            className="font-bold"
            onClick={backToList}
          >
            <ArrowLeft className="size-4" />
            Back to all proof types
          </Button>
        </div>
      </div>
    )
  }

  const availableOnSignup = selectedDocument.enabled !== false
  // OcrDocumentType has no `label` — this page was reading a property that does
  // not exist, so the heading and all three section "done" checks silently
  // evaluated undefined: the proof name never displayed and step one never
  // showed as complete. Same precedence the proof list uses.
  const proofDisplayName =
    selectedDocument.template_name?.trim() ||
    selectedDocument.name?.trim() ||
    ""

  return (
    <ProofWizardShell
      open
      title={proofDisplayName || "New document"}
      subtitle={
        missingSampleLabels.length
          ? `Add a ${missingSampleLabels.join(" and ")} sample photo to offer this`
          : availableOnSignup
            ? "Residents can choose this when they register"
            : "Hidden from residents for now"
      }
      onClose={() => void backToList()}
      saveState={autoSaveState}
      doneDisabled={!edited}
      actions={
        <div className="flex items-center gap-1.5">
          {/* Offering the document was a full-width switch at the bottom of a
              long scroll, restating in a sentence what the subtitle above
              already says. It is one binary about this document, so it belongs
              with the other one, and the subtitle is its label. */}
          <button
            type="button"
            onClick={() => {
              if (missingSamples.length > 0) {
                validateRequiredSamples(selectedDocument)
                return
              }
              setEdited(true)
              void setProofAvailableOnSignup(selectedDocument.key, !availableOnSignup)
            }}
            aria-pressed={availableOnSignup}
            title={
              missingSampleLabels.length
                ? `Add a ${missingSampleLabels.join(" and ")} sample photo first`
                : availableOnSignup
                  ? "Offered to residents — tap to hide"
                  : "Hidden from residents — tap to offer"
            }
            className={cn(
              "flex size-8 items-center justify-center rounded-full border transition-colors",
              missingSamples.length > 0
                ? "border-neutral-200 text-neutral-300"
                : availableOnSignup
                  ? "border-neutral-200 bg-neutral-100 text-neutral-900 hover:bg-neutral-200"
                  : "border-neutral-200 text-neutral-400 hover:text-neutral-900"
            )}
          >
            {availableOnSignup ? (
              <Eye className="size-4" aria-hidden />
            ) : (
              <EyeOff className="size-4" aria-hidden />
            )}
          </button>
          <div className="flex items-center rounded-full border border-neutral-200 p-0.5">
          <button
            type="button"
            onClick={() => changeCaptureMode("one")}
            title="Front only"
            aria-label="Front only"
            className={cn(
              "flex size-8 items-center justify-center rounded-full transition-colors",
              canvasSides.length === 1
                ? "bg-neutral-100 text-neutral-900"
                : "text-neutral-400 hover:text-neutral-900"
            )}
          >
            <IdCard className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => changeCaptureMode("both")}
            title="Front and back"
            aria-label="Front and back"
            className={cn(
              "flex size-8 items-center justify-center rounded-full transition-colors",
              canvasSides.length === 2
                ? "bg-neutral-100 text-neutral-900"
                : "text-neutral-400 hover:text-neutral-900"
            )}
          >
            <CreditCard className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      }
    >
      <ProofWorkspace
        document={selectedDocument}
        fields={fields}
        selectedField={selectedField}
        canvasSides={canvasSides}
        sampleSide={samplePreviewSide}
        onSampleSideChange={setSamplePreviewSide}
        sampleUrl={canvasSource}
        zoom={zoom}
        onSelectField={selectField}
        onAddField={() => {
          addField()
          setEdited(true)
        }}
        onRemoveField={(key) => {
          removeField(key)
          setEdited(true)
        }}
        onRenameField={(key, label) => {
          renameField(key, label)
          setEdited(true)
        }}
        onSetFieldRegion={(key, region) => {
          setFieldRegion(key, region)
          setEdited(true)
        }}
        onUploadSample={(file, side) => {
          void handleSampleUpload(file, side)
          setEdited(true)
        }}
        onChangeDocument={(patch) => {
          updateSelectedDocument((doc) => ({ ...doc, ...patch }))
          setEdited(true)
        }}
        onBlurSave={() => {
          void saveProofNameAndDescription()
        }}
        testSlots={testSlots}
        onUploadTestSlot={(side, file) => uploadTestSlot(side, file)}
        onClearTestSlot={(side) => clearTestSlot(side)}
        sampleMatchForSide={sampleMatchForSide}
        fieldMatchProfiles={fieldMatchProfiles}
        onChangeFieldMatches={changeFieldMatches}
        fieldLastRead={(key) => lastReadByKey.get(key) ?? null}
        onRemoveSample={(side) => {
          void handleSampleRemove(side)
          setEdited(true)
        }}
        saving={saving}
        tested={mergedTestResult.tested}
        checksFor={
          <RulesStep
            document={selectedDocument}
            fields={sortedCanvasFields}
            selectedField={selectedField}
            selectedFieldIndex={selectedFieldIndex}
            onSelectField={selectField}
            onUpdateField={(key, updater) => {
              updateField(key, updater)
              setEdited(true)
            }}
            onUpdateHints={(key, patch) => {
              updateFieldHints(key, patch)
              setEdited(true)
            }}
            onSetValidationRules={(key, next) => {
              setFieldValidationRules(key, next)
              setEdited(true)
            }}
            fieldMatchProfiles={fieldMatchProfiles}
            fieldHasNotExpired={fieldHasNotExpired}
            showFieldPicker={false}
          />
        }
        testPanel={
          <TrySampleProfileForm
            testRunning={testRunning}
            testProfile={testProfile}
            relevantProfileKeys={relevantProfileKeys}
            onTestProfileChange={(key, value) =>
              setTestProfileField(key, value)
            }
          />
        }
        resultsPanel={
          <TrySampleResults
            mergedTestResult={mergedTestResult}
            documentFields={selectedDocument.fields}
            canvasSides={canvasSides}
          />
        }
        testAction={
          <button
            type="button"
            onClick={() => void runTestAll()}
            disabled={testRunning}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-300"
          >
            {testRunning ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : null}
            {testRunning
              ? (() => {
                  const side = runningTestKey?.startsWith("test:")
                    ? (runningTestKey.slice(5) as ProofSide)
                    : null
                  if (side && canvasSides.length >= 2) {
                    const index = canvasSides.indexOf(side)
                    if (index >= 0)
                      return `Testing ${side === "back" ? "back" : "front"} (${index + 1} of ${canvasSides.length})`
                  }
                  return "Testing"
                })()
              : mergedTestResult.tested
                ? "Test again"
                : "Test sample"}
          </button>
        }
      />
    </ProofWizardShell>
  )
})

export default OcrTemplateBuilderPage
