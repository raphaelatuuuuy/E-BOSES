import { forwardRef, useImperativeHandle, useState } from "react"
import { ArrowLeft, LoaderCircle } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { usePageTitle } from "@/hooks/use-page-title"
import { ProofEditorSection } from "@/features/ocr/components/proof-editor-section"
import { ProofTypeList } from "@/features/ocr/components/proof-type-list"
import { MarkAreasStep } from "@/features/ocr/components/steps/mark-areas-step"
import { ProofDetailsStep } from "@/features/ocr/components/steps/proof-details-step"
import { RulesStep } from "@/features/ocr/components/steps/rules-step"
import { TrySampleStep } from "@/features/ocr/components/steps/try-sample-step"
import { PROOF_THEME } from "@/features/ocr/components/proof-theme"
import { useOcrTemplateState } from "@/features/ocr/hooks/use-ocr-template-state"

const OcrTemplateBuilderPage = forwardRef<{ startAddProofType: () => void }, object>(
  function OcrTemplateBuilderPage(_props, ref) {
    usePageTitle("ID & Proof Templates")
    const [view, setView] = useState<"list" | "wizard">("list")

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
    renameField,
    moveField,
    reorderField,
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
    runTestFromSample,
    setTestPhoto,
    validateRequiredSamples,
    missingRequiredSampleSides,
    extractedList,
    extractedByKey,
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
    side === "front" ? "Front" : side === "back" ? "Back" : "Sample",
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
      <div className={cn("flex min-h-[70vh] flex-col", PROOF_THEME.bg)}>
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
        <ProofTypeList
          documents={configuration.document_types}
          saving={saving}
          onAdd={() => {
            void addDocumentType()
            setView("wizard")
          }}
          onEdit={(docKey) => {
            setSelectedDocKey(docKey)
            const doc = configuration.document_types.find((item) => item.key === docKey)
            setSelectedFieldKey(doc?.fields[0]?.key ?? "")
            setTestResult(null)
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

  const sampleCount = countSamplePhotos(selectedDocument)
  const markedFields = selectedDocument.fields.filter((field) => field.extraction_hints?.region).length
  const availableOnSignup = selectedDocument.enabled !== false
  // OcrDocumentType has no `label` — this page was reading a property that does
  // not exist, so the heading and all three section "done" checks silently
  // evaluated undefined: the proof name never displayed and step one never
  // showed as complete. Same precedence the proof list uses.
  const proofDisplayName = selectedDocument.template_name?.trim() || selectedDocument.name?.trim() || ""

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => void backToList()}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              All proof types
            </button>
            <h2 className="mt-2 font-heading text-xl font-bold text-foreground">
              {proofDisplayName || "New proof type"}
            </h2>
            <p className="mt-1 text-sm font-medium text-muted-foreground">
              Set this up once. Residents pick from the types you switch on here.
            </p>
          </div>

          {/* The switch that actually matters, kept visible rather than buried
              on the wizard's last step. */}
          <label className="flex items-center gap-3 rounded-2xl border border-card-line bg-card px-4 py-3">
            <input
              type="checkbox"
              checked={availableOnSignup}
              onChange={(event) => {
                if (event.target.checked && !validateRequiredSamples(selectedDocument)) return
                void setProofAvailableOnSignup(selectedDocument.key, event.target.checked)
              }}
              className="size-4 accent-brand-orange"
            />
            <span>
              <span className="block text-sm font-bold text-foreground">Offer this at sign-up</span>
              <span className="block text-xs font-medium text-muted-foreground">
                {missingSampleLabels.length
                  ? `Add a ${missingSampleLabels.join(" and ")} sample first`
                  : "Residents can use this proof type"}
              </span>
            </span>
          </label>
        </div>

        <ProofEditorSection
          index={1}
          title="Name and photo sides"
          hint="What this proof is called, and whether it needs a front, back or one photo."
          done={Boolean(proofDisplayName)}
          doneLabel={`${proofDisplayName} · ${sampleCount} sample photo${sampleCount === 1 ? "" : "s"}`}
          defaultOpen={!proofDisplayName}
        >
          <ProofDetailsStep
            document={selectedDocument}
            samplePhotoCount={sampleCount}
            onChange={(patch) => {
              updateSelectedDocument((doc) => ({ ...doc, ...patch }))
            }}
            onBlurSave={() => {
              void saveProofNameAndDescription()
            }}
            onChangeCaptureMode={(mode) => changeCaptureMode(mode)}
          />
        </ProofEditorSection>

        <ProofEditorSection
          index={2}
          title="Mark where the details are"
          hint="Upload a sample photo, then draw a box around each detail to read."
          done={markedFields > 0 && missingSampleLabels.length === 0}
          doneLabel={`${markedFields} area${markedFields === 1 ? "" : "s"} marked`}
          defaultOpen={Boolean(proofDisplayName) && markedFields === 0}
        >
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
            onReorderField={reorderField}
            onUpdateField={updateField}
            onRenameField={renameField}
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
        </ProofEditorSection>

        <ProofEditorSection
          index={3}
          title="Checks for each detail"
          hint="What counts as a valid value — required, expiry date, name match."
          done={markedFields > 0}
          doneLabel="Adjust how strictly each detail is checked"
        >
          <RulesStep
            document={selectedDocument}
            fields={sortedCanvasFields}
            selectedField={selectedField}
            selectedFieldIndex={selectedFieldIndex}
            onSelectField={selectField}
            onUpdateField={updateField}
            onRenameField={renameField}
            onUpdateHints={updateFieldHints}
            onSetValidationRules={setFieldValidationRules}
            fieldMatchProfiles={fieldMatchProfiles}
            fieldHasNotExpired={fieldHasNotExpired}
            selectedDetected={selectedDetected}
          />
        </ProofEditorSection>

        <ProofEditorSection
          index={4}
          title="Try it on a real photo"
          hint="Check that the right details are read before residents use this."
          done={Boolean(testResult)}
          doneLabel="Last test run — try another any time"
        >
          <TrySampleStep
            documentKey={selectedDocument.key}
            testRunning={testRunning}
            testFile={testFile}
            testPreviewUrl={testPreviewUrl}
            testResult={testResult}
            extractedList={extractedList}
            documentFields={selectedDocument.fields}
            canvasSides={canvasSides}
            samplePreviewBySide={samplePreviewBySide}
            onPickFile={(file) => {
              void setTestPhoto(file)
            }}
            onRunTest={() => {
              void runTest(testFile)
            }}
            onRunTestFromSample={(side) => {
              void runTestFromSample(side)
            }}
          />
        </ProofEditorSection>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            type="button"
            onClick={() => void backToList()}
            disabled={saving}
            className="rounded-xl bg-brand-orange text-white hover:bg-brand-orange-strong"
          >
            {saving ? "Saving…" : "Done"}
          </Button>
          <span className="text-xs font-medium text-muted-foreground">
            Changes save as you make them.
          </span>
        </div>
      </div>
    </div>
  )
})

export default OcrTemplateBuilderPage
