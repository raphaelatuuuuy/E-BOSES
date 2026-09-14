import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Link } from "react-router-dom"
import * as LucideIcons from "lucide-react"
import {
  CircleCheck,
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  SirenIcon,
  CircleX,
  PencilLineIcon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react"
import { resolveIconByKey } from "@/features/dashboard/components/concerns/resolve-icon"
import { toast } from "sonner"

import { apiRequest, unwrapList, type ListEnvelope } from "@/lib/api"
import { describeApiError } from "@/features/dashboard/lib/api-errors"
import { ListSearch, PAGE_SIZE } from "@/components/ui/list-controls"
import {
  SheetActionRow,
  SheetDialog,
  SheetIconButton,
  SheetPrimaryButton,
  SheetSecondaryButton,
} from "@/features/dashboard/components/sheet-dialog"
import { ConfigurationPager } from "@/features/dashboard/components/config/configuration-list-controls"
import { ConfigurationTable, ConfigurationTableEmpty, ConfigurationTableRow } from "@/features/dashboard/components/config/configuration-table"
import {
  ConfigAlarm,
  ConfigHeroAction,
  ConfigShell,
} from "@/features/dashboard/components/config/config-shell"
import type {
  EmergencyCategory,
  EmergencyQuickQuestion,
  EmergencyQuickQuestionChoice,
} from "@/features/dashboard/emergency-api"
import { defaultQuickQuestionsForCategory } from "@/features/dashboard/components/sos/sos-questions"

interface Unit {
  id: number
  name: string
  short_name: string
  is_active: boolean
  responds_to_emergencies: boolean
  emergency_types: string[]
}

interface RoleMap {
  id: number
  emergency_type: string
  department: number | null
  department_name?: string
  priority: number
  requires_shift: boolean
  is_active: boolean
}

type Draft = Partial<EmergencyCategory> & { iconFile?: File | null }

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80)
}

function emergencyCode(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_")
}

/** The exact keys the backend accepts (see validate_icon_key). */
const EMERGENCY_ICONS: Array<{ key: string; label: string; Icon: LucideIcon }> =
  [
    { key: "activity", label: "Activity", Icon: LucideIcons.Activity },
    { key: "ambulance", label: "Ambulance", Icon: LucideIcons.Ambulance },
    { key: "baby", label: "Baby", Icon: LucideIcons.Baby },
    { key: "badge-alert", label: "Alert badge", Icon: LucideIcons.BadgeAlert },
    { key: "bell", label: "Bell", Icon: LucideIcons.Bell },
    {
      key: "cloud-rain-wind",
      label: "Storm",
      Icon: LucideIcons.CloudRainWind,
    },
    { key: "flame", label: "Fire", Icon: LucideIcons.Flame },
    { key: "heart-crack", label: "Heart", Icon: LucideIcons.HeartCrack },
    { key: "home", label: "Home", Icon: LucideIcons.Home },
    { key: "map-pin", label: "Map pin", Icon: LucideIcons.MapPin },
    { key: "pill", label: "Medicine", Icon: LucideIcons.Pill },
    { key: "shield-alert", label: "Shield", Icon: LucideIcons.ShieldAlert },
    { key: "siren", label: "Siren", Icon: LucideIcons.Siren },
    { key: "stethoscope", label: "Doctor", Icon: LucideIcons.Stethoscope },
    { key: "waves", label: "Flood", Icon: LucideIcons.Waves },
    { key: "zap", label: "Electric", Icon: LucideIcons.Zap },
  ]

function iconLabelFor(key: string) {
  return EMERGENCY_ICONS.find((entry) => entry.key === key)?.label ?? key
}

function iconFor(key: string) {
  return (
    EMERGENCY_ICONS.find((entry) => entry.key === key)?.Icon ??
    resolveIconByKey(key) ??
    SirenIcon
  )
}

const inputCls =
  "mt-1.5 w-full rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-[16px] text-neutral-900 outline-none transition-colors focus:border-neutral-500"
const labelCls = "text-[13px] font-semibold text-neutral-500"

/* Dropdown over the backend-supported keys — native <select> can't render icons,
   and free text is rejected by validate_icon_key, so search only filters. */
function IconDropdown({
  value,
  onChange,
  onPickCustom,
}: {
  value: string
  onChange: (key: string) => void
  onPickCustom?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const CurrentIcon = iconFor(value)
  const isCustomImage = value === "custom"
  const isKnownKey =
    !value ||
    isCustomImage ||
    EMERGENCY_ICONS.some((entry) => entry.key === value)
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return EMERGENCY_ICONS
    return EMERGENCY_ICONS.filter(
      (entry) =>
        entry.label.toLowerCase().includes(query) ||
        entry.key.toLowerCase().includes(query)
    )
  }, [search])

  function pick(key: string) {
    onChange(key)
    setSearch("")
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-neutral-300 bg-white px-4 py-3 text-left text-[16px] text-neutral-900 transition-colors outline-none hover:border-neutral-400"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-navy text-white">
          {createElement(CurrentIcon, {
            className: "size-4",
            strokeWidth: 1.7,
          })}
        </span>
        <span className="flex-1 truncate font-medium">
          {isCustomImage ? "Custom image" : iconLabelFor(value) || "Siren"}
        </span>
        {open ? (
          <ChevronUpIcon className="size-4 shrink-0 text-neutral-400" />
        ) : (
          <ChevronDownIcon className="size-4 shrink-0 text-neutral-400" />
        )}
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 w-full [scrollbar-width:none] overflow-hidden rounded-[14px] border-[1.5px] border-neutral-200 bg-white shadow-lg [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ maxHeight: "320px", overflowY: "auto" }}
        >
          <div className="px-4 py-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtered.length > 0) {
                  pick(filtered[0]!.key)
                }
              }}
              placeholder="Search icons…"
              aria-label="Search emergency icons"
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400"
            />
          </div>
          {!isKnownKey ? (
            <p
              className="border-b border-neutral-100 px-4 py-2.5 text-[12px] font-medium text-sos"
              role="alert"
            >
              “{value}” isn’t a supported icon and won’t save — pick one below.
            </p>
          ) : null}
          {filtered.length > 0 ? (
            <div className="grid grid-cols-4 gap-1 px-3 pb-3">
              {filtered.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  title={label}
                  onClick={() => pick(key)}
                  aria-pressed={value === key}
                  className={
                    value === key
                      ? "flex flex-col items-center gap-1 rounded-lg bg-brand-navy px-1 py-2 text-white"
                      : "flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-neutral-600 transition-colors hover:bg-neutral-100"
                  }
                >
                  <Icon
                    className="size-5"
                    strokeWidth={1.7}
                    aria-hidden="true"
                  />
                  <span className="max-w-full truncate text-[10px] font-medium">
                    {label}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="px-4 pb-4 text-center text-[12px] text-neutral-400">
              No icons match — only the supported emergency icons can be used.
            </p>
          )}
          <div className="border-t border-neutral-100 py-1">
            <button
              type="button"
              onClick={() => {
                onChange("custom")
                setSearch("")
                setOpen(false)
                onPickCustom?.()
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] text-neutral-700 transition hover:bg-neutral-50"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-dashed border-neutral-300 bg-neutral-50 text-[10px] font-bold text-neutral-400">
                IMG
              </span>
              Custom image
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function QuickQuestionsEditor({
  value,
  onChange,
}: {
  value?: EmergencyQuickQuestion[]
  onChange: (next: EmergencyQuickQuestion[]) => void
}) {
  const questions = value ?? []

  function updateQuestion(
    index: number,
    next: Partial<EmergencyQuickQuestion>
  ) {
    onChange(
      questions.map((question, current) =>
        current === index ? { ...question, ...next } : question
      )
    )
  }

  function updateChoice(
    questionIndex: number,
    choiceIndex: number,
    next: Partial<EmergencyQuickQuestionChoice>
  ) {
    const question = questions[questionIndex]
    if (!question) return
    updateQuestion(questionIndex, {
      choices: question.choices.map((choice, current) =>
        current === choiceIndex ? { ...choice, ...next } : choice
      ),
    })
  }

  function moveQuestion(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= questions.length) return
    const next = [...questions]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    onChange(next)
  }

  function moveChoice(
    questionIndex: number,
    choiceIndex: number,
    direction: -1 | 1
  ) {
    const question = questions[questionIndex]
    if (!question) return
    const target = choiceIndex + direction
    if (target < 0 || target >= question.choices.length) return
    const choices = [...question.choices]
    ;[choices[choiceIndex], choices[target]] = [
      choices[target]!,
      choices[choiceIndex]!,
    ]
    updateQuestion(questionIndex, { choices })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className={labelCls}>Quick questions</p>
          <p className="mt-1 text-[13px] text-neutral-500">
            These questions and choices appear in the resident SOS wizard for
            this type.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...questions,
              {
                key: `question_${questions.length + 1}`,
                question: "New question",
                choices: [{ value: "yes", label: "Yes" }],
              },
            ])
          }
          className="shrink-0 rounded-full border border-neutral-300 px-3 py-2 text-[12px] font-semibold text-neutral-700 transition hover:bg-neutral-50"
        >
          Add question
        </button>
      </div>

      {questions.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-neutral-300 bg-neutral-50 px-4 py-3 text-[13px] text-neutral-500">
          No quick questions configured. Residents will see the standard
          fallback questions.
        </div>
      ) : null}

      {questions.map((question, questionIndex) => (
        <div
          key={`${question.key}-${questionIndex}`}
          className="rounded-[16px] border border-neutral-200 bg-neutral-50 p-4"
        >
          <div className="mb-3 flex items-start gap-2">
            <div className="grid flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <label>
                <span className="sr-only">Question text</span>
                <input
                  value={question.question}
                  onChange={(event) =>
                    updateQuestion(questionIndex, {
                      question: event.target.value,
                    })
                  }
                  className={inputCls.replace("mt-1.5", "")}
                  placeholder="Question shown to residents"
                />
              </label>
              <label>
                <span className="sr-only">Question key</span>
                <input
                  value={question.key}
                  onChange={(event) =>
                    updateQuestion(questionIndex, { key: event.target.value })
                  }
                  className={inputCls.replace("mt-1.5", "")}
                  placeholder="question_key"
                />
              </label>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                aria-label="Move question up"
                disabled={questionIndex === 0}
                onClick={() => moveQuestion(questionIndex, -1)}
                className="rounded-lg p-2 text-neutral-500 hover:bg-white disabled:opacity-30"
              >
                <ChevronUpIcon className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Move question down"
                disabled={questionIndex === questions.length - 1}
                onClick={() => moveQuestion(questionIndex, 1)}
                className="rounded-lg p-2 text-neutral-500 hover:bg-white disabled:opacity-30"
              >
                <ChevronDownIcon className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Remove question"
                onClick={() =>
                  onChange(
                    questions.filter((_, index) => index !== questionIndex)
                  )
                }
                className="rounded-lg p-2 text-neutral-500 hover:bg-white hover:text-sos"
              >
                <CircleX className="size-4" />
              </button>
            </div>
          </div>

          <div className="space-y-2 pl-0 sm:pl-3">
            {question.choices.map((choice, choiceIndex) => (
              <div
                key={`${choice.value}-${choiceIndex}`}
                className="flex items-center gap-2"
              >
                <input
                  aria-label={`Choice ${choiceIndex + 1} value`}
                  value={choice.value}
                  onChange={(event) =>
                    updateChoice(questionIndex, choiceIndex, {
                      value: event.target.value,
                    })
                  }
                  className="w-32 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[13px] text-neutral-900 outline-none focus:border-neutral-500"
                  placeholder="answer_value"
                />
                <input
                  aria-label={`Choice ${choiceIndex + 1} label`}
                  value={choice.label}
                  onChange={(event) =>
                    updateChoice(questionIndex, choiceIndex, {
                      label: event.target.value,
                    })
                  }
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-[13px] text-neutral-900 outline-none focus:border-neutral-500"
                  placeholder="Answer shown to residents"
                />
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label="Move choice up"
                    disabled={choiceIndex === 0}
                    onClick={() => moveChoice(questionIndex, choiceIndex, -1)}
                    className="rounded-lg p-1.5 text-neutral-500 hover:bg-white disabled:opacity-30"
                  >
                    <ChevronUpIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move choice down"
                    disabled={choiceIndex === question.choices.length - 1}
                    onClick={() => moveChoice(questionIndex, choiceIndex, 1)}
                    className="rounded-lg p-1.5 text-neutral-500 hover:bg-white disabled:opacity-30"
                  >
                    <ChevronDownIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove choice"
                    onClick={() =>
                      updateQuestion(questionIndex, {
                        choices: question.choices.filter(
                          (_, index) => index !== choiceIndex
                        ),
                      })
                    }
                    className="rounded-lg p-1.5 text-neutral-500 hover:bg-white hover:text-sos"
                  >
                    <CircleX className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                updateQuestion(questionIndex, {
                  choices: [
                    ...question.choices,
                    {
                      value: `choice_${question.choices.length + 1}`,
                      label: "New choice",
                    },
                  ],
                })
              }
              className="text-[12px] font-semibold text-neutral-600 hover:text-brand-navy"
            >
              + Add choice
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function OfficialDispatchRulesPage() {
  const [units, setUnits] = useState<Unit[]>([])
  const [categories, setCategories] = useState<EmergencyCategory[]>([])
  const [maps, setMaps] = useState<RoleMap[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [originalDraft, setOriginalDraft] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      apiRequest<Unit[]>("/concerns/admin/departments/"),
      apiRequest<EmergencyCategory[]>("/emergencies/categories/"),
      apiRequest<RoleMap[] | ListEnvelope<RoleMap>>(
        "/emergencies/role-maps/"
      ).then(unwrapList),
    ])
      .then(([nextUnits, nextCategories, nextMaps]) => {
        setUnits(nextUnits)
        setCategories(nextCategories)
        setMaps(nextMaps)
      })
      .catch((error) =>
        toast.error(describeApiError(error, "Could not load dispatch rules."))
      )
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    // Defer the initial fetch one macrotask so the mount render settles first;
    // load() sets loading synchronously (reused by refresh handlers).
    const id = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(id)
  }, [load])

  const respondingUnits = useMemo(
    () =>
      units.filter((unit) => unit.is_active && unit.responds_to_emergencies),
    [units]
  )

  function explicitRules(code: string) {
    const target = emergencyCode(code)
    return maps.filter(
      (item) =>
        emergencyCode(item.emergency_type) === target &&
        item.is_active &&
        item.department
    )
  }

  function declaringUnits(code: string) {
    const target = emergencyCode(code)
    return units.filter(
      (unit) =>
        unit.is_active &&
        unit.responds_to_emergencies &&
        (unit.emergency_types || []).some(
          (declaredCode) => emergencyCode(declaredCode) === target
        )
    )
  }

  const uncovered = categories.filter(
    (category) =>
      category.is_active &&
      !category.is_covered &&
      explicitRules(category.code).length === 0 &&
      declaringUnits(category.code).length === 0
  )

  async function saveCategory() {
    if (!draft?.label?.trim()) return
    setBusy("category")
    const payload = new FormData()
    payload.append("code", draft.code || slugify(draft.label))
    payload.append("label", draft.label.trim())
    payload.append("subtext", (draft.subtext || "").trim())
    payload.append("icon_key", draft.icon_key || "siren")
    payload.append("custom_icon_label", (draft.custom_icon_label || "").trim())
    payload.append(
      "sort_order",
      String(draft.sort_order ?? categories.length * 10 + 10)
    )
    payload.append("is_active", String(draft.is_active ?? true))
    payload.append(
      "visible_to_residents",
      String(draft.visible_to_residents ?? true)
    )
    payload.append(
      "quick_questions",
      JSON.stringify(draft.quick_questions ?? [])
    )
    if (draft.iconFile) payload.append("icon_image", draft.iconFile)
    try {
      await apiRequest(
        draft.id
          ? `/emergencies/categories/${draft.id}/`
          : "/emergencies/categories/",
        {
          method: draft.id ? "PATCH" : "POST",
          body: payload,
        }
      )
      toast.success(
        draft.id ? "Emergency category updated" : "Emergency category added"
      )
      setDraft(null)
      load()
    } catch (error) {
      toast.error(describeApiError(error, "Could not save emergency category."))
    } finally {
      setBusy(null)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setBusy(deleteTarget.code)
    try {
      await apiRequest(`/emergencies/categories/${deleteTarget.id}/`, {
        method: "DELETE",
      })
      toast.success("Emergency category removed")
      setDeleteOpen(false)
      setDeleteTarget(null)
      load()
    } catch (error) {
      toast.error(
        describeApiError(error, "Could not remove emergency category.")
      )
    } finally {
      setBusy(null)
    }
  }

  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<EmergencyCategory | null>(
    null
  )
  const [query, setQuery] = useState("")
  const [offset, setOffset] = useState(0)

  const draftSnapshot = (value: Draft | null) =>
    JSON.stringify({
      id: value?.id ?? null,
      label: value?.label ?? "",
      code: value?.code ?? "",
      subtext: value?.subtext ?? "",
      icon_key: value?.icon_key ?? "siren",
      custom_icon_label: value?.custom_icon_label ?? "",
      icon_image_url: value?.icon_image_url ?? "",
      is_active: value?.is_active ?? true,
      visible_to_residents: value?.visible_to_residents ?? true,
      quick_questions: value?.quick_questions ?? [],
    })

  const filtered = useMemo(() => {
    if (!query) return categories
    const q = query.toLowerCase()
    return categories.filter((c) =>
      `${c.label} ${c.code} ${c.subtext}`.toLowerCase().includes(q)
    )
  }, [categories, query])

  const page = filtered.slice(offset, offset + PAGE_SIZE)

  return (
    <ConfigShell
      icon={SirenIcon}
      eyebrow="Operations"
      title="Emergency types"
      description="The SOS buttons residents see, and which unit answers each one."
      action={
        <ConfigHeroAction
          icon={PlusIcon}
          onClick={() => {
            setDraft({
              icon_key: "siren",
              is_active: true,
              visible_to_residents: true,
              quick_questions: defaultQuickQuestionsForCategory("other"),
            })
            setOriginalDraft(null)
            setEditOpen(true)
          }}
        >
          Add category
        </ConfigHeroAction>
      }
      stats={[
        {
          label: "Categories",
          value: categories.filter((item) => item.is_active).length,
        },
        {
          label: "Unanswered",
          value: uncovered.length,
          alarm: uncovered.length > 0,
        },
        { label: "Responding units", value: respondingUnits.length },
      ]}
    >
      {!loading && uncovered.length > 0 ? (
        <ConfigAlarm>
          No unit answers: {uncovered.map((item) => item.label).join(", ")}.
          These SOS categories will escalate instead of auto-routing.
        </ConfigAlarm>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <ListSearch
          value={query}
          onChange={setQuery}
          placeholder="Search emergency categories"
          className="w-full"
        />
      </div>

      <ConfigurationTable label="Emergency categories">
        {page.map((category) => {
          const Icon = iconFor(category.icon_key)
          const covered =
            category.is_covered ||
            explicitRules(category.code).length > 0 ||
            declaringUnits(category.code).length > 0
          const unitNames = declaringUnits(category.code).map(
            (u) => u.short_name || u.name
          )
          const isActive = category.is_active
          return (
            <ConfigurationTableRow
              key={category.id}
              actions={
                <>
                  <SheetIconButton
                    label={`Edit ${category.label}`}
                    onClick={() => {
                      setDraft({
                        ...category,
                        quick_questions: category.quick_questions?.length
                          ? category.quick_questions
                          : defaultQuickQuestionsForCategory(category.code),
                      })
                      setOriginalDraft(draftSnapshot(category))
                      setEditOpen(true)
                    }}
                  >
                    <PencilLineIcon className="size-5" strokeWidth={1.8} aria-hidden />
                  </SheetIconButton>
                  <SheetIconButton
                    label={`Remove ${category.label}`}
                    onClick={() => {
                      setDeleteTarget(category)
                      setDeleteOpen(true)
                    }}
                    className="text-neutral-500 hover:text-sos"
                  >
                    <Trash2Icon className="size-5" strokeWidth={1.8} aria-hidden />
                  </SheetIconButton>
                </>
              }
            >
              {/* Name + details */}
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-navy text-white">
                    {category.icon_image_url ? (
                      <img
                        src={category.icon_image_url}
                        alt=""
                        className="size-full rounded-lg object-cover"
                      />
                    ) : (
                      <Icon className="size-4" strokeWidth={1.7} />
                    )}
                  </span>
                  <span className="text-row text-brand-navy">
                    {category.label}
                  </span>
                  {isActive && covered ? (
                    <span className="inline-flex items-center gap-1 text-meta text-green-600">
                      <CircleCheck className="size-3.5" strokeWidth={2} />
                      Covered
                    </span>
                  ) : isActive ? (
                    <span className="inline-flex items-center gap-1 text-meta text-red-600">
                      <CircleX className="size-3.5" strokeWidth={2} />
                      No unit
                    </span>
                  ) : null}
                </div>
                <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                  <div>
                    <dt className="text-meta text-neutral-400">Description</dt>
                    <dd className="mt-0.5 text-meta text-brand-navy">
                      {category.subtext || category.code}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-meta text-neutral-400">
                      Units assigned
                    </dt>
                    <dd className="mt-0.5 text-meta text-brand-navy">
                      {unitNames.length > 0 ? unitNames.join(", ") : "None"}
                    </dd>
                  </div>
                </dl>
              </div>

            </ConfigurationTableRow>
          )
        })}
        {page.length === 0 && !loading ? (
          <ConfigurationTableEmpty>
            No emergency categories found.
          </ConfigurationTableEmpty>
        ) : null}
      </ConfigurationTable>

      <ConfigurationPager
        pageSize={PAGE_SIZE}
        offset={offset}
        total={filtered.length}
        onChange={setOffset}
        noun="types"
      />

      {respondingUnits.length === 0 && !loading ? (
        <p className="rounded-2xl border border-card-line bg-card p-6 text-center text-sm font-semibold text-muted-foreground">
          No unit is marked as an emergency responder yet. Set that up in{" "}
          <Link
            to="/dashboard/configuration/units"
            className="text-brand-navy underline"
          >
            Configuration → Units
          </Link>{" "}
          first.
        </p>
      ) : null}

      {/* Edit dialog */}
      {draft && (
        <SheetDialog
          open={editOpen}
          onClose={() => {
            setEditOpen(false)
            setDraft(null)
            setOriginalDraft(null)
          }}
          title={
            draft.id ? `Edit ${draft.label} Emergency` : "New emergency type"
          }
          size="wide"
          footer={
            <SheetActionRow>
              <SheetSecondaryButton
                disabled={busy === "category"}
                onClick={() => {
                  setEditOpen(false)
                  setDraft(null)
                }}
              >
                Cancel
              </SheetSecondaryButton>
              <SheetPrimaryButton
                tone="accent"
                disabled={
                  busy === "category" ||
                  !draft.label?.trim() ||
                  Boolean(draft.id && draftSnapshot(draft) === originalDraft)
                }
                onClick={() => void saveCategory()}
              >
                {busy === "category"
                  ? "Saving…"
                  : draft.id
                    ? "Save changes"
                    : "Create category"}
              </SheetPrimaryButton>
            </SheetActionRow>
          }
        >
          <div className="space-y-6 pb-4">
            {/* Basic info */}
            <div className="space-y-4">
              <label className="block">
                <span className={labelCls}>Category name</span>
                <input
                  value={draft.label || ""}
                  onChange={(e) => {
                    const label = e.target.value
                    setDraft((current) => ({
                      ...current,
                      label,
                      code: current?.id ? current.code : slugify(label),
                    }))
                  }}
                  className={inputCls}
                  placeholder="Fire"
                />
              </label>
              <label className="block">
                <span className={labelCls}>Description</span>
                <input
                  value={draft.subtext || ""}
                  onChange={(e) =>
                    setDraft((current) => ({
                      ...current,
                      subtext: e.target.value,
                    }))
                  }
                  className={inputCls}
                  placeholder="Fire, smoke, burning"
                />
              </label>
            </div>

            {/* Icon dropdown with icons */}
            <div className="space-y-2">
              <p className={labelCls}>Icon</p>
              <IconDropdown
                value={draft.icon_key || "siren"}
                onChange={(key) =>
                  setDraft((current) => ({ ...current, icon_key: key }))
                }
                onPickCustom={() =>
                  window.setTimeout(() => fileInputRef.current?.click(), 0)
                }
              />
            </div>

            <div className="space-y-2">
              <p className={labelCls}>Alerts map</p>
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    visible_to_residents: !(
                      current?.visible_to_residents ?? true
                    ),
                  }))
                }
                className="flex w-full items-center gap-3 rounded-[14px] border-[1.5px] border-neutral-200 px-4 py-3 text-left transition hover:bg-neutral-50"
              >
                <span className="flex-1 text-[15px]">
                  <span className="block text-[15px] font-medium text-neutral-900">
                    Visible to residents
                  </span>
                  <span className="block text-[13px] text-neutral-500">
                    Active alerts under this type show as pins on the resident
                    alerts map
                  </span>
                </span>
                {draft.visible_to_residents !== false ? (
                  <CircleCheck className="size-5 text-green-600" />
                ) : (
                  <span className="size-5 rounded-full border-[1.5px] border-neutral-300" />
                )}
              </button>
            </div>

            <QuickQuestionsEditor
              value={draft.quick_questions}
              onChange={(quick_questions) =>
                setDraft((current) => ({ ...current, quick_questions }))
              }
            />

            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.ico,image/png,image/jpeg,image/webp,image/x-icon"
              onChange={(e) =>
                setDraft((current) => ({
                  ...current,
                  iconFile: e.target.files?.[0] ?? null,
                }))
              }
              className="hidden"
            />
          </div>

        </SheetDialog>
      )}

      {/* Delete dialog */}
      <SheetDialog
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false)
          setDeleteTarget(null)
        }}
        title={deleteTarget ? `Remove ${deleteTarget.label}?` : ""}
        description="Alerts already filed under this category keep their history. This cannot be undone."
        footer={
          <SheetActionRow>
            <SheetSecondaryButton
              disabled={busy === deleteTarget?.code}
              onClick={() => {
                setDeleteOpen(false)
                setDeleteTarget(null)
              }}
            >
              Cancel
            </SheetSecondaryButton>
            <SheetPrimaryButton
              tone="danger"
              disabled={busy === deleteTarget?.code}
              onClick={() => void confirmDelete()}
            >
              {busy === deleteTarget?.code
                ? "Removing\u2026"
                : "Remove category"}
            </SheetPrimaryButton>
          </SheetActionRow>
        }
      />
    </ConfigShell>
  )
}
