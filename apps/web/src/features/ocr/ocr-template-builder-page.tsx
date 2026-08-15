import { forwardRef, useImperativeHandle, useState } from "react"
import { ArrowLeft, LoaderCircle } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

import { usePageTitle } from "@/hooks/use-page-title"
import { ProofWizardShell } from "@/features/ocr/components/wizard-shell"
import { ProofWorkspace } from "@/features/ocr/components/proof-workspace"
import { ProofTypeList } from "@/features/ocr/components/proof-type-list"
import { RulesStep } from "@/features/ocr/components/steps/rules-step"
import { TrySampleStep } from "@/features/ocr/components/steps/try-sample-step"
import { useOcrTemplateState } from "@/features/ocr/hooks/use-ocr-template-state"

const OcrTemplateBuilderPage = forwardRef<
  { startAddProofType: () => void },
  object
>(function OcrTemplateBuilderPage(_props, ref) {
  usePageTitle("ID & Proof Templates")
  const [view, setView] = useState<"list" | "wizard">("list")

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
    selectedDetected,
  } = useOcrTemplateState()

  useImperativeHandle(ref, () => ({
    startAddProofType() {
      void addDocumentType()
      setView("wizard")
    },
  }))

  const missingSamples = missingRequiredSampleSides(selectedDocument)
  const missingSampleLabels = missingSamples.map((side) =>
    side === "front" ? "Front" : side === "back" ? "Back" : "Sample"
  )

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
          setView("wizard")
        }}
        onEdit={(docKey) => {
          beginEditingDocument(docKey)
          resetTests()
          setView("wizard")
        }}
        onRemove={(docKey) => {
          void removeDocumentType(docKey)
        }}
        onToggleAvailable={(docKey, enabled) => {
          void setProofAvailableOnSignup(docKey, enabled)
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
        availableOnSignup
          ? "Residents can choose this on sign-up"
          : "Not offered on sign-up yet"
      }
      onClose={() => void backToList()}
      saveState={autoSaveState}
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
        onAddField={() => addField()}
        onRemoveField={removeField}
        onRenameField={renameField}
        onSetFieldRegion={setFieldRegion}
        onUploadSample={(file, side) => {
          void handleSampleUpload(file, side)
        }}
        onChangeDocument={(patch) =>
          updateSelectedDocument((doc) => ({ ...doc, ...patch }))
        }
        onBlurSave={() => {
          void saveProofNameAndDescription()
        }}
        onChangeCaptureMode={(mode) => changeCaptureMode(mode)}
        saving={saving}
        tested={mergedTestResult.tested}
        availableOnSignup={availableOnSignup}
        onAvailabilityChange={(next) => {
          if (next && !validateRequiredSamples(selectedDocument)) return
          void setProofAvailableOnSignup(selectedDocument.key, next)
        }}
        availabilityHint={
          missingSampleLabels.length
            ? `Add a ${missingSampleLabels.join(" and ")} sample photo first.`
            : "Residents can choose this document when they register."
        }
        checksFor={
          <RulesStep
            document={selectedDocument}
            fields={sortedCanvasFields}
            selectedField={selectedField}
            selectedFieldIndex={selectedFieldIndex}
            onSelectField={selectField}
            onUpdateField={updateField}
            onUpdateHints={updateFieldHints}
            onSetValidationRules={setFieldValidationRules}
            fieldMatchProfiles={fieldMatchProfiles}
            fieldHasNotExpired={fieldHasNotExpired}
            selectedDetected={selectedDetected}
            showFieldPicker={false}
          />
        }
        testPanel={
          <TrySampleStep
            testRunning={testRunning}
            runningTestKey={runningTestKey}
            testSlots={testSlots}
            mergedTestResult={mergedTestResult}
            documentFields={selectedDocument.fields}
            canvasSides={canvasSides}
            sampleMatchForSide={sampleMatchForSide}
            testProfile={testProfile}
            relevantProfileKeys={relevantProfileKeys}
            onTestProfileChange={(key, value) =>
              setTestProfileField(key, value)
            }
            onUploadSlot={(side, file) => uploadTestSlot(side, file)}
            onClearSlot={(side) => clearTestSlot(side)}
            onRunTestAll={() => {
              void runTestAll()
            }}
          />
        }
      />
    </ProofWizardShell>
  )
})

export default OcrTemplateBuilderPage
