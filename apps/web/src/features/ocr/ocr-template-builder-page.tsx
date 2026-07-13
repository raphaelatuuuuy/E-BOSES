import { useState } from "react"
import { ArrowLeft, LoaderCircle } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { Topbar } from "@/features/dashboard/components/topbar"
import { usePageTitle } from "@/hooks/use-page-title"
import { ProofSetupWizard } from "@/features/ocr/components/proof-setup-wizard"
import { ProofTypeList } from "@/features/ocr/components/proof-type-list"
import { MarkAreasStep } from "@/features/ocr/components/steps/mark-areas-step"
import { ProofDetailsStep } from "@/features/ocr/components/steps/proof-details-step"
import { RulesStep } from "@/features/ocr/components/steps/rules-step"
import { TrySampleStep } from "@/features/ocr/components/steps/try-sample-step"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"
import {
  useOcrTemplateState,
  type WizardStepId,
} from "@/features/ocr/hooks/use-ocr-template-state"

export default function OcrTemplateBuilderPage() {
  usePageTitle("ID & Proof Templates")
  const [view, setView] = useState<"list" | "wizard">("list")
  const [step, setStep] = useState<WizardStepId>(1)

  const {
    configuration,
    loading,
    saving,
    error,
    selectedDocument,
    selectedField,
    fields,
    fieldSearch,
    setFieldSearch,
    setSelectedDocKey,
    setSelectedFieldKey,
    updateSelectedDocument,
    updateField,
    updateFieldHints,
    saveProofNameAndDescription,
    setProofAvailableOnSignup,
    persistWizardExit,
    addDocumentType,
    removeDocumentType,
    changeCaptureMode,
    countSamplePhotos,
    canvasSides,
    fieldMatchProfiles,
    fieldHasNotExpired,
    setFieldValidationRules,
    addField,
    removeField,
    moveField,
    selectField,
    setFieldRegion,
    samplePreviewSide,
    setSamplePreviewSide,
    samplePreviewBySide,
    sampleInputRef,
    sampleUploadSideRef,
    handleSampleUpload,
    handleSampleRemove,
    zoom,
    setZoom,
    sortedCanvasFields,
    selectedFieldIndex,
    canvasSource,
    testFile,
    testPreviewUrl,
    testResult,
    setTestResult,
    testRunning,
    runTest,
    extractedList,
    extractedByKey,
    selectedDetected,
  } = useOcrTemplateState()

  async function backToList() {
    await persistWizardExit()
    setStep(1)
    setView("list")
  }

  if (loading) {
    return (
      <div className={cn("flex min-h-[70vh] flex-col", PROOF_THEME.bg)}>
        <Topbar />
        <div className="flex flex-1 items-center justify-center gap-3">
          <LoaderCircle className="size-8 animate-spin text-[#145be7]" />
          <span className={cn("text-sm font-semibold", PROOF_THEME.muted)}>
            Loading proof templates…
          </span>
        </div>
      </div>
    )
  }

  if (!configuration) {
    return (
      <div className={cn("flex min-h-full flex-col", PROOF_THEME.bg)}>
        <Topbar />
        <div
          className="m-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700"
          role="alert"
        >
          {error || "Proof templates are unavailable right now."}
        </div>
      </div>
    )
  }

  if (view === "list") {
    return (
      <div className={cn("flex min-h-full flex-col", PROOF_THEME.bg)}>
        <Topbar />
        <ProofTypeList
          documents={configuration.document_types}
          saving={saving}
          onAdd={() => {
            void addDocumentType()
            setStep(1)
            setView("wizard")
          }}
          onEdit={(docKey) => {
            setSelectedDocKey(docKey)
            const doc = configuration.document_types.find((item) => item.key === docKey)
            setSelectedFieldKey(doc?.fields[0]?.key ?? "")
            setTestResult(null)
            setStep(1)
            setView("wizard")
          }}
          onRemove={(docKey) => {
            void removeDocumentType(docKey)
          }}
          onToggleAvailable={(docKey, enabled) => {
            void setProofAvailableOnSignup(docKey, enabled)
          }}
        />
      </div>
    )
  }

  if (!selectedDocument) {
    return (
      <div className={cn("flex min-h-full flex-col", PROOF_THEME.bg)}>
        <Topbar />
        <div
          className="m-6 space-y-4 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700"
          role="alert"
        >
          <p>{error || "Select a proof type to continue setup."}</p>
          <Button type="button" variant="outline" className="font-bold" onClick={backToList}>
            <ArrowLeft className="size-4" />
            Back to all proof types
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("flex min-h-full flex-col", PROOF_THEME.bg)}>
      <Topbar />
      <ProofSetupWizard
        document={selectedDocument}
        step={step}
        saving={saving}
        onStepChange={setStep}
        onBackToList={() => {
          void backToList()
        }}
        onDone={() => {
          void backToList()
        }}
        availableEnabled={selectedDocument.enabled !== false}
        onToggleAvailable={(enabled) => {
          void setProofAvailableOnSignup(selectedDocument.key, enabled)
        }}
      >
        {step === 1 ? (
          <ProofDetailsStep
            document={selectedDocument}
            samplePhotoCount={countSamplePhotos(selectedDocument)}
            onChange={(patch) => {
              updateSelectedDocument((doc) => ({ ...doc, ...patch }))
            }}
            onBlurSave={() => {
              void saveProofNameAndDescription()
            }}
            onChangeCaptureMode={(mode) => changeCaptureMode(mode)}
          />
        ) : null}

        {step === 2 ? (
          <MarkAreasStep
            document={selectedDocument}
            fields={fields}
            fieldSearch={fieldSearch}
            setFieldSearch={setFieldSearch}
            samplePreviewBySide={samplePreviewBySide}
            samplePreviewSide={samplePreviewSide}
            setSamplePreviewSide={setSamplePreviewSide}
            canvasSides={canvasSides}
            selectedFieldKey={selectedField?.key ?? ""}
            onSelectField={selectField}
            onAddField={addField}
            onRemoveField={removeField}
            onMoveField={moveField}
            onUploadSample={(file, side) => {
              void handleSampleUpload(file, side)
            }}
            onRemoveSample={(side) => {
              void handleSampleRemove(side)
            }}
            onSetFieldRegion={setFieldRegion}
            saving={saving}
            zoom={zoom}
            setZoom={setZoom}
            canvasSource={canvasSource}
            extractedByKey={extractedByKey}
            sampleInputRef={sampleInputRef}
            sampleUploadSideRef={sampleUploadSideRef}
          />
        ) : null}

        {step === 3 ? (
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
          />
        ) : null}

        {step === 4 ? (
          <TrySampleStep
            documentKey={selectedDocument.key}
            testRunning={testRunning}
            testFile={testFile}
            testPreviewUrl={testPreviewUrl}
            testResult={testResult}
            extractedList={extractedList}
            onPickFile={(file) => {
              void runTest(file)
            }}
            onRunAgain={() => {
              void runTest(testFile)
            }}
          />
        ) : null}
      </ProofSetupWizard>
    </div>
  )
}
