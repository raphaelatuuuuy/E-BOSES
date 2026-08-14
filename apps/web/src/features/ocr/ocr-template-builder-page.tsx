import { forwardRef, useImperativeHandle, useState } from "react"
import { ArrowLeft, Check, LoaderCircle } from "lucide-react"

import { ConfigBreadcrumb } from "@/features/dashboard/components/config/config-shell"

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
    autoSaveState,
    error,
    selectedDocument,
    selectedField,
    fields,
    fieldSearch,
    setFieldSearch,
    setSelectedDocKey,
    setSelectedFieldKey,
    editedDocKeys,
    addedDocKeys,
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
          <LoaderCircle className="size-8 animate-spin text-brand-blue" />
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
          className="m-6 rounded-2xl border border-neutral-200 bg-neutral-100 p-6 text-sos"
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
      </div>
    )
  }

  if (!selectedDocument) {
    return (
      <div className={cn("flex min-h-full flex-col", PROOF_THEME.bg)}>
        <div
          className="m-6 space-y-4 rounded-2xl border border-neutral-200 bg-neutral-100 p-6 text-sos"
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
  // A doc created this session and never edited carries a placeholder name and
  // pre-placed default regions — none of that counts as real setup, so its
  // sections stay unchecked until the official actually configures something.
  const isUntouchedNewDoc =
    addedDocKeys.has(selectedDocument.key) && !editedDocKeys.has(selectedDocument.key)

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <ConfigBreadcrumb
              trail={[
                { label: "All proof types", onClick: () => void backToList() },
                { label: proofDisplayName || "New proof type" },
              ]}
            />
            <h2 className="mt-2 font-heading text-xl font-semibold text-foreground">
              {proofDisplayName || "New proof type"}
            </h2>
            {autoSaveState !== "idle" ? (
              <span
                className={cn(
                  "mt-1 inline-flex items-center gap-1 text-[11px] font-semibold",
                  autoSaveState === "error"
                    ? "text-sos"
                    : autoSaveState === "saved"
                      ? "text-foreground"
                      : "text-muted-foreground",
                )}
                aria-live="polite"
              >
                {autoSaveState === "saving" || autoSaveState === "pending" ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : autoSaveState === "saved" ? (
                  <Check className="size-3" />
                ) : null}
                {autoSaveState === "pending" || autoSaveState === "saving"
                  ? "Saving…"
                  : autoSaveState === "saved"
                    ? "Saved"
                    : autoSaveState === "error"
                      ? "Save failed — will retry"
                      : ""}
              </span>
            ) : null}
          </div>

          <label className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-line-tint bg-white px-4 py-3 transition-colors duration-150 hover:border-brand-blue/40">
            <span className="relative flex size-[18px] shrink-0 items-center justify-center">
              <input
                type="checkbox"
                checked={availableOnSignup}
                onChange={(event) => {
                  if (event.target.checked && !validateRequiredSamples(selectedDocument)) return
                  void setProofAvailableOnSignup(selectedDocument.key, event.target.checked)
                }}
                className="peer size-[18px] cursor-pointer appearance-none rounded-[5px] border-2 border-line-tint bg-white transition-colors duration-150 hover:border-brand-blue/60 checked:border-brand-blue checked:bg-brand-blue focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue/70"
              />
              <Check
                aria-hidden
                strokeWidth={3.5}
                className="pointer-events-none absolute size-3.5 text-white opacity-0 transition-opacity duration-150 peer-checked:opacity-100"
              />
            </span>
            <span>
              <span className="block text-sm font-semibold text-foreground">Available on sign-up</span>
              <span className="block text-xs font-medium text-muted-foreground">
                {missingSampleLabels.length
                  ? `Add a ${missingSampleLabels.join(" and ")} sample first.`
                  : "Residents can choose this ID when registering."}
              </span>
            </span>
          </label>
        </div>

        <ProofEditorSection
          index={1}
          title="Name and photo sides"
          done={!isUntouchedNewDoc && Boolean(proofDisplayName)}
          doneLabel={`${proofDisplayName}, ${sampleCount} sample photo${sampleCount === 1 ? "" : "s"}`}
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
            sampleInputRef={sampleInputRef}
            sampleUploadSideRef={sampleUploadSideRef}
          />
        </ProofEditorSection>

        <ProofEditorSection
          index={3}
          title="Checks for each detail"
          done={!isUntouchedNewDoc && markedFields > 0}
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
          done={mergedTestResult.tested}
        >
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
            onTestProfileChange={(key, value) => setTestProfileField(key, value)}
            onUploadSlot={(side, file) => uploadTestSlot(side, file)}
            onClearSlot={(side) => clearTestSlot(side)}
            onRunTestAll={() => {
              void runTestAll()
            }}
          />
        </ProofEditorSection>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            type="button"
            onClick={() => void backToList()}
            disabled={saving}
            className={cn("rounded-xl text-white", PROOF_THEME.primaryBg)}
          >
            {saving ? "Saving..." : "Done"}
          </Button>
          <span className="text-xs font-medium text-muted-foreground">
            Changes save automatically.
          </span>
        </div>
      </div>
    </div>
  )
})

export default OcrTemplateBuilderPage