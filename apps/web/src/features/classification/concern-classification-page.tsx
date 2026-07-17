import { useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangleIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  FileSearchIcon,
  FlagIcon,
  ImageIcon,
  LoaderCircleIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TestTube2Icon,
  UploadCloudIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Topbar } from "@/features/dashboard/components/topbar"
import { usePageTitle } from "@/hooks/use-page-title"
import {
  getConcernClassificationConfig,
  resetConcernClassificationConfig,
  saveConcernClassificationConfig,
  testConcernImage,
  testConcernReport,
  type ConcernClassificationConfig,
  type ImageClassificationResult,
  type ReportValidationResult,
} from "./api"

type Tab = "image" | "report"

const defaults: ConcernClassificationConfig = {
  revision: 0,
  image_model: "YOLOv8m",
  text_model: "multilingual zero-shot classification",
  image_confidence_threshold: 0.7,
  text_relevance_threshold: 0.7,
  duplicate_similarity_threshold: 0.85,
  minimum_description_length: 20,
  mismatch_action: "manual_review",
  flag_suspicious: true,
  flag_duplicates: true,
  flag_irrelevant: true,
  notify_reviewer: true,
  suspicious_terms: ["test", "testing", "asdf", "qwerty", "12345"],
  supported_classes: ["person", "car", "truck", "dog", "cat", "traffic light", "fire hydrant", "stop sign"],
  label_mappings: { pothole: "infrastructure", "traffic light": "infrastructure", garbage: "environment", dog: "public_safety" },
  category_keywords: {},
  mapping_targets: [],
  categories: [
    { key: "infrastructure", label: "Infrastructure", enabled: true, detected_labels: ["pothole", "damaged road", "traffic light", "fire hydrant"] },
    { key: "environment", label: "Environment", enabled: true, detected_labels: ["garbage", "trash", "waste", "floodwater"] },
    { key: "public_safety", label: "Public Safety", enabled: true, detected_labels: ["person", "car", "dog", "fire", "smoke"] },
    { key: "others", label: "Others", enabled: true, detected_labels: [] },
  ],
}

function percent(value: number | null | undefined) {
  return value == null ? "Not calibrated" : `${Math.round(value * 100)}%`
}

function Panel({ title, step, children, className }: { title: string; step?: number; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-[#dfe7f5] bg-white p-5 shadow-sm", className)}>
      <h2 className="flex items-center gap-2 text-base font-black text-[#07145f]">
        {step ? <span className="flex size-7 items-center justify-center rounded-full bg-[#07145f] text-xs text-white">{step}</span> : null}
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function RangeSetting({ label, value, min = 0.5, max = 1, step = 0.01, onChange, help }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void; help: string }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-3 text-sm font-black text-[#07145f]"><span>{label}</span><span className="text-lg text-[#145be7]">{Math.round(value * 100)}%</span></span>
      <input className="mt-3 w-full accent-[#145be7]" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <span className="mt-2 block rounded-lg bg-[#f2f6ff] p-2 text-xs font-semibold leading-5 text-[#43507f]">{help}</span>
    </label>
  )
}

function ModelStatus({ name, detail, ready = true }: { name: string; detail: string; ready?: boolean }) {
  return <div className="flex items-center gap-3 rounded-xl border border-[#dfe7f5] bg-[#f8fafc] p-3"><span className={cn("flex size-10 items-center justify-center rounded-full", ready ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700")}>{ready ? <CheckCircle2Icon className="size-5" /> : <AlertTriangleIcon className="size-5" />}</span><div><p className="text-xs font-bold text-[#68739c]">{ready ? "Model ready" : "Official review mode"}</p><p className="font-black text-[#07145f]">{name}</p><p className="text-[11px] font-semibold text-[#68739c]">{detail}</p></div></div>
}

function OutcomeCard({ tone, title, detail, example }: { tone: "green" | "amber" | "red"; title: string; detail: string; example: string }) {
  const styles = tone === "green" ? "border-green-200 bg-green-50 text-green-700" : tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-red-200 bg-red-50 text-red-700"
  return <section className="rounded-2xl border border-[#dfe7f5] bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", styles)}>{tone === "green" ? <CheckCircle2Icon className="size-6" /> : <AlertTriangleIcon className="size-6" />}</span><div><h3 className="font-black text-[#07145f]">{title}</h3><p className="mt-1 text-xs font-semibold leading-5 text-[#43507f]">{detail}</p></div></div><p className={cn("mt-4 rounded-lg border p-3 text-xs font-semibold", styles)}><span className="font-black">Example:</span> {example}</p></section>
}

export default function ConcernClassificationPage() {
  usePageTitle("Concern Classification")
  const [tab, setTab] = useState<Tab>("image")
  const [config, setConfig] = useState(defaults)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [selectedCategory, setSelectedCategory] = useState(defaults.categories[0].key)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState("")
  const [imageResult, setImageResult] = useState<ImageClassificationResult | null>(null)
  const [description, setDescription] = useState("")
  const [reportResult, setReportResult] = useState<ReportValidationResult | null>(null)
  const [term, setTerm] = useState("")
  const [mappingLabel, setMappingLabel] = useState("")
  const [mappingCategory, setMappingCategory] = useState("infrastructure")
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void getConcernClassificationConfig()
      .then((next) => setConfig({ ...defaults, ...next, categories: next.categories?.length ? next.categories : defaults.categories }))
      .catch(() => toast.warning("Using the recommended starting settings until the service is available."))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!imageFile) { setImagePreview(""); return }
    const url = URL.createObjectURL(imageFile)
    setImagePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  const activeCategories = useMemo(() => config.categories.filter((category) => category.enabled), [config.categories])
  const metricCards: Array<[React.ElementType, string, React.ReactNode, string, string]> = [
    [SparklesIcon, "Active categories", activeCategories.length, "Types residents can select", "text-[#145be7] bg-blue-50"],
    [ImageIcon, "Photo accuracy", percent(config.metrics?.image_accuracy), "Measured from reviewed reports", "text-green-700 bg-green-50"],
    [ShieldCheckIcon, "Text accuracy", percent(config.metrics?.text_accuracy), "Measured from reviewed reports", "text-violet-700 bg-violet-50"],
    [FileSearchIcon, "Checked automatically", config.metrics?.auto_validated ?? 0, "Reports that passed checks", "text-[#145be7] bg-blue-50"],
    [FlagIcon, "Sent to officials", config.metrics?.flagged ?? 0, "Reports needing attention", "text-orange-700 bg-orange-50"],
  ]

  function update<K extends keyof ConcernClassificationConfig>(key: K, value: ConcernClassificationConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    setBusy("save")
    try { setConfig(await saveConcernClassificationConfig(config)); toast.success("Concern checking settings saved.") }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not save the settings.") }
    finally { setBusy("") }
  }

  async function reset() {
    setBusy("reset")
    try { setConfig(await resetConcernClassificationConfig()); toast.success("Recommended settings restored.") }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not restore the settings.") }
    finally { setBusy("") }
  }

  async function runImageTest() {
    if (!imageFile) return
    setBusy("image")
    setImageResult(null)
    try { setImageResult(await testConcernImage(imageFile, selectedCategory)) }
    catch (error) { toast.error(error instanceof Error ? error.message : "The photo could not be checked.") }
    finally { setBusy("") }
  }

  async function runReportTest() {
    if (!description.trim()) return
    setBusy("report")
    setReportResult(null)
    try { setReportResult(await testConcernReport(selectedCategory, description.trim())) }
    catch (error) { toast.error(error instanceof Error ? error.message : "The written report could not be checked.") }
    finally { setBusy("") }
  }

  if (loading) return <div className="flex min-h-[70vh] items-center justify-center bg-[#f7f8fc]"><LoaderCircleIcon className="size-8 animate-spin text-[#145be7]" /></div>

  return (
    <div className="flex min-h-full flex-col bg-[#f7f8fc]">
      <Topbar />
      <main className="space-y-5 p-4 md:p-7">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div><h1 className="text-2xl font-black text-[#07145f] md:text-3xl">AI Report Validation</h1><p className="mt-2 max-w-2xl text-sm font-semibold text-[#43507f]">Configure how AI checks citizen-submitted concerns before an official makes the final decision.</p></div>
          <div className="flex flex-wrap gap-2"><Button onClick={() => void save()} disabled={Boolean(busy)} className="bg-[#145be7] text-white hover:bg-[#104bc0]"><SaveIcon className="size-4" /> {busy === "save" ? "Saving…" : "Save Configuration"}</Button><Button variant="outline" onClick={() => void reset()} disabled={Boolean(busy)}><RotateCcwIcon className="size-4" /> Reset Defaults</Button><Button variant="outline" onClick={() => document.getElementById(tab === "image" ? "test-image-detection" : "test-report-validation")?.scrollIntoView({ behavior: "smooth" })}><TestTube2Icon className="size-4" /> Test Validation</Button></div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {metricCards.map(([Icon, label, value, help, color]) => <section key={label} className="rounded-2xl border border-[#dfe7f5] bg-white p-4 shadow-sm"><div className="flex items-center gap-3"><span className={cn("flex size-11 items-center justify-center rounded-full", color)}><Icon className="size-5" /></span><div><p className="text-xs font-bold text-[#68739c]">{label}</p><p className="text-2xl font-black text-[#07145f]">{value}</p></div></div><p className="mt-3 text-[11px] font-semibold text-[#68739c]">{help}</p></section>)}
        </div>

        <div className="flex gap-2 overflow-x-auto border-b border-[#dfe7f5]">
          <button type="button" onClick={() => setTab("image")} className={cn("flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-black", tab === "image" ? "border-[#145be7] text-[#145be7]" : "border-transparent text-[#68739c]")}><ImageIcon className="size-4" /> Image Classification</button>
          <button type="button" onClick={() => setTab("report")} className={cn("flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-black", tab === "report" ? "border-[#145be7] text-[#145be7]" : "border-transparent text-[#68739c]")}><BrainCircuitIcon className="size-4" /> Report Validation</button>
        </div>

        {tab === "image" ? <div className="grid gap-5 xl:grid-cols-12">
          <Panel title="Supported Classes" step={1} className="xl:col-span-6">
            <p className="mb-4 text-sm font-semibold text-[#43507f]">YOLOv8m’s base model can recognize these 80 general COCO objects. Use Category Mapping to decide what a detected object means for E-Boses.</p>
            <div className="grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-4">{(config.supported_classes ?? []).map((label) => <div key={label} className="rounded-xl border border-[#dfe7f5] bg-[#f8fafc] p-3"><div className="flex items-center justify-between gap-2"><span className="font-black capitalize text-[#07145f]">{label}</span><CheckCircle2Icon className="size-4 text-green-600" /></div><p className="mt-1 text-[11px] font-semibold text-[#68739c]">COCO-supported</p></div>)}</div>
            <div className="mt-4"><ModelStatus ready={config.image_available === true} name="YOLOv8 medium (COCO base)" detail={config.image_available ? "General-object detection is available. Civic meanings still depend on the mapping rules." : "Model weights are unavailable. Photos safely go to an official until configured."} /></div>
          </Panel>
          <Panel title="Image Detection Rules" step={2} className="xl:col-span-3"><RangeSetting label="Confidence Threshold" value={config.image_confidence_threshold} onChange={(value) => update("image_confidence_threshold", value)} help="If confidence is lower, mark the report as Needs Review." /></Panel>
          <Panel title="Category Mapping" step={3} className="xl:col-span-3">
            <p className="mb-3 text-xs font-semibold leading-5 text-[#43507f]">Connect a detected YOLO label to an existing report category.</p>
            <div className="max-h-48 space-y-2 overflow-y-auto">{Object.entries(config.label_mappings).map(([label, category]) => <div key={label} className="flex items-center justify-between gap-2 rounded-lg bg-[#f8fafc] p-2 text-xs"><span className="font-black capitalize text-[#07145f]">{label}</span><span className="font-bold capitalize text-[#145be7]">{category.replace(/_/g, " ")}</span><button type="button" aria-label={`Remove ${label} mapping`} onClick={() => { const next = { ...config.label_mappings }; delete next[label]; update("label_mappings", next) }} className="font-black text-red-600">×</button></div>)}</div>
            <div className="mt-3 grid gap-2"><input value={mappingLabel} onChange={(event) => setMappingLabel(event.target.value)} placeholder="Detected label" className="h-9 rounded-lg border border-[#cbd8ee] px-2 text-xs font-semibold" /><select value={mappingCategory} onChange={(event) => setMappingCategory(event.target.value)} className="h-9 rounded-lg border border-[#cbd8ee] bg-white px-2 text-xs font-bold">{config.mapping_targets?.length ? ["concern", "emergency"].map((group) => <optgroup key={group} label={group === "concern" ? "Concern categories" : "Emergency types"}>{config.mapping_targets?.filter((target) => target.group === group).map((target) => <option key={target.key} value={target.key}>{target.label}</option>)}</optgroup>) : config.categories.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}</select><Button size="sm" variant="outline" onClick={() => { const label = mappingLabel.trim().toLowerCase(); if (label) update("label_mappings", { ...config.label_mappings, [label]: mappingCategory }); setMappingLabel("") }}><PlusIcon className="size-4" /> Add Mapping</Button></div>
          </Panel>
          <Panel title="Mismatch Handling" step={4} className="xl:col-span-3"><p className="mb-3 text-sm font-semibold text-[#43507f]">When the detected category differs from what the resident selected:</p><select value={config.mismatch_action} onChange={(event) => update("mismatch_action", event.target.value as ConcernClassificationConfig["mismatch_action"])} className="h-11 w-full rounded-lg border border-[#cbd8ee] bg-white px-3 text-sm font-bold text-[#07145f]"><option value="manual_review">Flag For Review</option><option value="request_resubmission">Request Resubmission</option><option value="reject">Reject Automatically</option></select><p className="mt-3 rounded-lg bg-[#f2f6ff] p-3 text-xs font-semibold leading-5 text-[#43507f]">The report is held for an official before final action. This is the recommended choice for a base model.</p></Panel>
          <Panel title="Test Image Detection" step={5} className="xl:col-span-9"><div id="test-image-detection" className="grid gap-5 lg:grid-cols-3"><div><label className="text-sm font-black text-[#07145f]">Selected Category</label><select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[#cbd8ee] bg-white px-3 text-sm font-bold text-[#07145f]">{activeCategories.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}</select><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { setImageFile(event.target.files?.[0] ?? null); setImageResult(null) }} /><button type="button" onClick={() => fileRef.current?.click()} className="mt-3 flex min-h-36 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#b8c9e8] bg-[#f8fafc] p-4 text-center"><UploadCloudIcon className="size-8 text-[#145be7]" /><span className="mt-2 text-sm font-black text-[#07145f]">{imageFile?.name ?? "Upload Test Image"}</span><span className="text-xs font-semibold text-[#68739c]">JPG, PNG or WebP</span></button><Button onClick={() => void runImageTest()} disabled={!imageFile || Boolean(busy)} className="mt-3 w-full bg-[#145be7] text-white hover:bg-[#104bc0]"><TestTube2Icon className="size-4" /> {busy === "image" ? "Detecting…" : "Run Image Detection"}</Button></div><div className="overflow-hidden rounded-xl border border-[#dfe7f5] bg-[#f8fafc]"><p className="border-b border-[#dfe7f5] p-3 text-sm font-black text-[#07145f]">Sample Preview</p>{imagePreview ? <img src={imagePreview} alt="Concern test preview" className="h-72 w-full object-cover" /> : <div className="flex h-72 items-center justify-center text-sm font-semibold text-[#68739c]">No image selected</div>}</div><div className="rounded-xl border border-[#dfe7f5] p-4"><p className="text-sm font-black text-[#07145f]">Detection Results</p>{imageResult ? <div className="mt-4 space-y-3">{imageResult.annotated_image ? <img src={imageResult.annotated_image} alt="YOLO inference with bounding boxes, labels, and confidence scores" className="max-h-64 w-full rounded-lg border border-[#dfe7f5] bg-black object-contain" /> : null}<ResultRow label="Detected Label" value={imageResult.detected_label} /><ResultRow label="Detected Category" value={imageResult.detected_category || "Needs mapping"} /><ResultRow label="Confidence" value={percent(imageResult.confidence)} /><ResultRow label="Selected Category" value={imageResult.selected_category} />{imageResult.objects?.length ? <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg bg-[#f8fafc] p-2">{imageResult.objects.map((object, index) => <div key={`${object.label}-${index}`} className="flex justify-between gap-2 text-xs"><span className="font-bold capitalize text-[#07145f]">{object.label}</span><span className="font-black text-[#145be7]">{percent(object.confidence)}</span></div>)}</div> : null}<ResultBadge value={imageResult.outcome} /><p className="text-xs font-semibold leading-5 text-[#43507f]">{imageResult.message}</p></div> : <p className="mt-4 text-sm font-semibold leading-6 text-[#68739c]">Upload an image to see detected objects, confidence, and category match.</p>}</div></div></Panel>
        </div> : null}

        {tab === "report" ? <div className="grid gap-5 xl:grid-cols-12">
          <div className="grid gap-4 md:grid-cols-3 xl:col-span-12">
            <OutcomeCard tone="green" title="Related" detail="The report description matches the selected category." example="There is a large pothole on Sampaguita Street." />
            <OutcomeCard tone="amber" title="Irrelevant" detail="The description does not match the selected category." example="Category: Flood · Description: There are many stray dogs." />
            <OutcomeCard tone="red" title="Suspicious" detail="Potential spam, abuse, or meaningless text." example="asdfasdf, test, 123123" />
          </div>
          <Panel title="Minimum Description Requirements" className="xl:col-span-3"><label className="flex items-center justify-between text-sm font-black text-[#07145f]">Character Count <span className="text-lg text-[#145be7]">{config.minimum_description_length}</span></label><input type="range" min="10" max="150" step="5" value={config.minimum_description_length} onChange={(event) => update("minimum_description_length", Number(event.target.value))} className="mt-3 w-full accent-[#145be7]" /><p className="mt-3 text-xs font-semibold leading-5 text-[#68739c]">Reports shorter than this are flagged for review.</p><div className="mt-4"><ModelStatus name="Multilingual text checker" detail="Supports Filipino, Taglish, and English descriptions." /></div></Panel>
          <Panel title="Suspicious Content Rules" className="xl:col-span-3"><div className="flex flex-wrap gap-2">{config.suspicious_terms.map((word) => <button key={word} type="button" onClick={() => update("suspicious_terms", config.suspicious_terms.filter((item) => item !== word))} className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700">{word} ×</button>)}</div><div className="mt-3 flex gap-2"><input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Add keyword" className="h-10 min-w-0 flex-1 rounded-lg border border-[#cbd8ee] px-3 text-sm font-semibold text-[#07145f]" /><Button variant="outline" onClick={() => { const next = term.trim().toLowerCase(); if (next && !config.suspicious_terms.includes(next)) update("suspicious_terms", [...config.suspicious_terms, next]); setTerm("") }}><PlusIcon className="size-4" /> Add</Button></div><p className="mt-3 text-xs font-semibold text-[#68739c]">These terms flag a report; they do not automatically reject it.</p></Panel>
          <Panel title="Duplicate Report Detection" className="xl:col-span-2"><label className="mb-4 flex items-center justify-between text-sm font-black text-[#07145f]">Enabled <input type="checkbox" checked={config.flag_duplicates} onChange={(event) => update("flag_duplicates", event.target.checked)} className="size-5 accent-[#145be7]" /></label><RangeSetting label="Similarity Threshold" value={config.duplicate_similarity_threshold} onChange={(value) => update("duplicate_similarity_threshold", value)} help="Similar nearby reports are flagged for officials to combine." /></Panel>
          <Panel title="Relevance Threshold" className="xl:col-span-2"><RangeSetting label="Required Match" value={config.text_relevance_threshold} onChange={(value) => update("text_relevance_threshold", value)} help="Below this score, the report is marked Irrelevant and reviewed." /></Panel>
          <Panel title="Auto Moderation Settings" className="xl:col-span-2"><div className="space-y-3">{[["flag_suspicious", "Flag Suspicious Reports"], ["flag_duplicates", "Flag Duplicate Reports"], ["flag_irrelevant", "Flag Irrelevant Reports"], ["notify_reviewer", "Automatically Notify Reviewer"]].map(([key, label]) => <label key={key} className="flex items-start gap-2 text-xs font-bold leading-5 text-[#07145f]"><input type="checkbox" checked={Boolean(config[key as keyof ConcernClassificationConfig])} onChange={(event) => update(key as keyof ConcernClassificationConfig, event.target.checked as never)} className="mt-0.5 size-4 accent-[#145be7]" />{label}</label>)}</div></Panel>
          <Panel title="Test Report Validation" className="xl:col-span-8"><div id="test-report-validation" className="grid gap-4 md:grid-cols-2"><div><label className="text-sm font-black text-[#07145f]">Selected Category</label><select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-[#cbd8ee] bg-white px-3 text-sm font-bold text-[#07145f]">{activeCategories.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}</select><label className="mt-3 block text-sm font-black text-[#07145f]">Citizen Report</label><textarea value={description} onChange={(event) => { setDescription(event.target.value); setReportResult(null) }} placeholder="Maraming nakatambak na basura sa Sampaguita Street malapit sa covered court." className="mt-2 min-h-32 w-full rounded-lg border border-[#cbd8ee] p-3 text-sm font-semibold text-[#07145f]" /><div className="mt-1 text-right text-xs font-bold text-[#68739c]">{description.length} characters</div><Button onClick={() => void runReportTest()} disabled={!description.trim() || Boolean(busy)} className="mt-2 w-full bg-[#145be7] text-white hover:bg-[#104bc0]"><TestTube2Icon className="size-4" /> {busy === "report" ? "Validating…" : "Run Report Validation"}</Button></div><div className="rounded-xl border border-[#dfe7f5] p-4"><p className="text-sm font-black text-[#07145f]">Validation Result</p>{reportResult ? <div className="mt-4 space-y-3"><ResultRow label="Classification" value={reportResult.classification} /><ResultRow label="Confidence" value={percent(reportResult.confidence)} /><ResultRow label="Category Match" value={reportResult.category_match == null ? "Not available" : reportResult.category_match ? "Valid" : "Mismatch"} /><ResultRow label="Duplicate" value={reportResult.duplicate ? "Possible duplicate" : "No match"} /><ResultBadge value={reportResult.outcome} /><p className="rounded-lg bg-[#f2f6ff] p-3 text-xs font-semibold leading-5 text-[#43507f]">{reportResult.explanation}</p></div> : <p className="mt-4 text-sm font-semibold leading-6 text-[#68739c]">Run a safe sample to see its classification, confidence, category match, and status.</p>}</div></div></Panel>
          <Panel title="Validation Outcome Distribution" className="xl:col-span-4"><div className="flex min-h-48 flex-col items-center justify-center rounded-xl bg-[#f8fafc] text-center"><BrainCircuitIcon className="size-10 text-[#b8c9e8]" /><p className="mt-3 font-black text-[#07145f]">Not calibrated</p><p className="mt-1 max-w-xs text-xs font-semibold leading-5 text-[#68739c]">Related, Irrelevant, and Suspicious percentages will appear after officials review enough real outcomes.</p></div></Panel>
        </div> : null}
      </main>
    </div>
  )
}

function ResultRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 border-b border-[#eef2f8] pb-2 text-sm"><span className="font-semibold text-[#68739c]">{label}</span><span className="text-right font-black capitalize text-[#07145f]">{value.replace(/_/g, " ")}</span></div> }
function ResultBadge({ value }: { value: string }) { const good = value === "match" || value === "approved"; return <div className={cn("flex items-center justify-center gap-2 rounded-xl p-3 text-sm font-black capitalize", good ? "bg-green-50 text-green-700" : "bg-orange-50 text-orange-800")}>{good ? <CheckCircle2Icon className="size-5" /> : <AlertTriangleIcon className="size-5" />}{value.replace(/_/g, " ")}</div> }
