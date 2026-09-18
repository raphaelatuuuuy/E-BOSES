import { forwardRef, useImperativeHandle, useState } from "react"
import { IdCardLanyardIcon } from "lucide-react"
import {
  ArrowLeft,
  LoaderCircle,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"

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
  const [confirmingWizardRemove, setConfirmingWizardRemove] = useState(false)

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
    setConfirmingWizardRemove(false)
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
  const canRemoveDoc = configuration.document_types.some((doc) => doc.key === selectedDocument.key)
  return (
    <ProofWizardShell
      open
      title={<span className="inline-flex items-center gap-2"><IdCardLanyardIcon className="size-6" strokeWidth={2} aria-hidden />ID Document<span className="text-brand-orange">Details</span></span>}
      subtitle={
        missingSampleLabels.length
          ? `Add a ${missingSampleLabels.join(" and ")} sample photo to offer this`
          : availableOnSignup
            ? undefined
            : "Hidden from residents for now"
      }
      onClose={() => void backToList()}
      saveState={autoSaveState}
      doneDisabled={!edited}
      onDelete={canRemoveDoc ? () => setConfirmingWizardRemove(true) : undefined}
      confirmingDelete={confirmingWizardRemove}
      onCancelDelete={() => setConfirmingWizardRemove(false)}
      onConfirmDelete={() => { setConfirmingWizardRemove(false); setView("list"); void removeDocumentType(selectedDocument.key) }}
      deleting={saving}
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
        availableOnSignup={availableOnSignup}
        onToggleAvailable={() => {
          if (missingSamples.length > 0) {
            validateRequiredSamples(selectedDocument)
            return
          }
          setEdited(true)
          void setProofAvailableOnSignup(selectedDocument.key, !availableOnSignup)
        }}
        availabilityLocked={missingSamples.length > 0}
        captureMode={canvasSides.length === 2 ? "both" : "one"}
        onCaptureModeChange={(mode) => changeCaptureMode(mode)}
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
