import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { searchResidentsForMention } from "@/features/auth/api"
import {
  displayToStorage,
  extractMentionStack,
  firstNameOf,
  findActiveMention,
  reconcileStack,
  storageToDisplay,
  toMentionUser,
  type MentionRef,
  type MentionUser,
} from "@/features/dashboard/components/comment-mentions"

/**
 * The @-mention textarea.
 *
 * Moved out of `comment-mentions.tsx`, which paired this one component with
 * nine pure string helpers. Mixing them meant the module was not a Fast Refresh
 * boundary: editing `firstNameOf` reloaded the whole feed and discarded any
 * half-written comment. The helpers stay put — they are imported in several
 * places — and the component moved instead.
 */

type MentionFieldProps = {
  id?: string
  /** Storage-format body */
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  placeholder?: string
  localUsers: MentionUser[]
  className?: string
  inputClassName?: string
  autoFocus?: boolean
  compact?: boolean
}

export function MentionTextField({
  id,
  value,
  onChange,
  onSubmit,
  placeholder,
  localUsers,
  className,
  inputClassName,
  autoFocus,
  compact,
}: MentionFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [cursor, setCursor] = useState(0)
  const [remoteUsers, setRemoteUsers] = useState<MentionUser[]>([])
  const [highlight, setHighlight] = useState(0)

  const [display, setDisplay] = useState(() => storageToDisplay(value))
  const [stack, setStack] = useState<MentionRef[]>(() =>
    extractMentionStack(value)
  )

  // Parent reset / reply prefill (storage tokens → short display). Adjusted
  // during render when `value` changes instead of via a sync setState effect.
  const [prevValue, setPrevValue] = useState(value)
  if (prevValue !== value) {
    setPrevValue(value)
    setDisplay(storageToDisplay(value))
    setStack(extractMentionStack(value))
  }

  function emit(nextDisplay: string, nextStack: MentionRef[]) {
    setDisplay(nextDisplay)
    setStack(nextStack)
    onChange(displayToStorage(nextDisplay, nextStack))
  }

  const active = useMemo(
    () => findActiveMention(display, cursor, stack),
    [display, cursor, stack]
  )

  // Drop stale remote results as soon as the mention query dissolves (render-adjust
  // instead of a sync setState in the search effect below).
  const activeQuery = active?.query ?? null
  const [prevActiveQuery, setPrevActiveQuery] = useState(activeQuery)
  if (prevActiveQuery !== activeQuery) {
    setPrevActiveQuery(activeQuery)
    if (!active) setRemoteUsers([])
  }

  useEffect(() => {
    if (!active) return
    const q = active.query
    const t = window.setTimeout(
      () => {
        void searchResidentsForMention(q || undefined)
          .then((rows) => {
            setRemoteUsers(
              rows.map((r) =>
                toMentionUser({
                  id: r.id,
                  full_name: r.full_name,
                  firstName: r.firstName,
                  lastName: r.lastName,
                })
              )
            )
          })
          .catch(() => setRemoteUsers([]))
      },
      q ? 180 : 0
    )
    return () => window.clearTimeout(t)
  }, [active])

  const suggestions = useMemo(() => {
    if (!active) return []
    const q = active.query.toLowerCase()
    const seen = new Set<number>()
    const out: MentionUser[] = []
    const push = (u: MentionUser) => {
      if (seen.has(u.id)) return
      const name = u.full_name.toLowerCase()
      const first = firstNameOf(u.full_name).toLowerCase()
      if (!q || first.startsWith(q) || name.includes(q)) {
        seen.add(u.id)
        out.push(u)
      }
    }
    remoteUsers.forEach(push)
    localUsers.forEach(push)
    return out.slice(0, 10)
  }, [active, localUsers, remoteUsers])

  // Reset the arrow-key highlight whenever the suggestion list changes
  // (render-adjust instead of a sync effect).
  const suggestionKey = `${suggestions.length}/${active?.query ?? ""}`
  const [prevSuggestions, setPrevSuggestions] = useState(suggestionKey)
  if (prevSuggestions !== suggestionKey) {
    setPrevSuggestions(suggestionKey)
    setHighlight(0)
  }

  function insertMention(user: MentionUser) {
    if (!active) return
    const name = firstNameOf(user.full_name)
    const insert = `@${name} `
    const nextDisplay =
      display.slice(0, active.start) + insert + display.slice(cursor)

    const beforePart = display.slice(0, active.start)
    const afterPart = display.slice(cursor)
    const beforeStack = reconcileStack(beforePart, stack)
    const afterStack = reconcileStack(afterPart, stack)
    const nextStack: MentionRef[] = [
      ...beforeStack,
      { name, id: user.id },
      ...afterStack,
    ]

    emit(nextDisplay, nextStack)

    const pos = active.start + insert.length
    window.requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(pos, pos)
      setCursor(pos)
    })
  }

  function onDisplayChange(nextDisplay: string) {
    emit(nextDisplay, reconcileStack(nextDisplay, stack))
  }

  const padClass = compact
    ? "py-1.5 pl-3.5 pr-10 text-[14px]"
    : "py-2 pl-4 pr-11 text-[15px]"
  const heightClass = compact ? "h-9" : "h-10"
  const hasMentions = stack.length > 0

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      {/* Same-length highlight as input — no long raw tokens, no ghost gap */}
      {hasMentions ? (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-full",
            "flex items-center whitespace-pre",
            padClass,
            heightClass,
            !display && "invisible"
          )}
        >
          <span className="block w-full truncate text-neutral-900">
            {renderDisplayHighlight(display, stack)}
          </span>
        </div>
      ) : null}

      <input
        ref={inputRef}
        id={id}
        type="text"
        autoFocus={autoFocus}
        value={display}
        placeholder={placeholder}
        onChange={(e) => {
          onDisplayChange(e.target.value)
          setCursor(e.target.selectionStart ?? e.target.value.length)
        }}
        onClick={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
        onKeyUp={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
        onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (suggestions.length > 0 && active) {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setHighlight((h) => (h + 1) % suggestions.length)
              return
            }
            if (e.key === "ArrowUp") {
              e.preventDefault()
              setHighlight(
                (h) => (h - 1 + suggestions.length) % suggestions.length
              )
              return
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault()
              const pick = suggestions[highlight]
              if (pick) insertMention(pick)
              return
            }
            if (e.key === "Escape") {
              e.preventDefault()
              setCursor(active.start + 1)
              return
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            onSubmit?.()
          }
        }}
        className={cn(
          "relative z-[1] w-full rounded-full border border-neutral-200 outline-none",
          heightClass,
          padClass,
          "placeholder:text-neutral-400",
          "focus:border-neutral-300 focus:ring-2 focus:ring-neutral-100",
          hasMentions
            ? "bg-transparent text-transparent caret-neutral-900"
            : "bg-white text-neutral-900",
          inputClassName
        )}
      />

      {active && suggestions.length > 0 ? (
        <ul
          className="absolute bottom-full left-0 z-30 mb-1 max-h-52 w-full min-w-[220px] overflow-y-auto rounded-xl border border-neutral-200 bg-white py-1 shadow-lg"
          role="listbox"
        >
          {suggestions.map((u, i) => (
            <li key={u.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-[14px]",
                  i === highlight ? "bg-neutral-100" : "hover:bg-neutral-50"
                )}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(u)
                }}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-soft text-[12px] font-semibold text-navy-muted">
                  {firstNameOf(u.full_name)[0]?.toUpperCase() ?? "U"}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-neutral-900">
                    {firstNameOf(u.full_name)}
                  </span>
                  <span className="block truncate text-[12px] text-neutral-500">
                    {u.full_name}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function renderDisplayHighlight(
  display: string,
  stack: MentionRef[]
): ReactNode {
  if (!display) return "\u00a0"
  const pending = [...stack]
  const parts: Array<{ kind: "text" | "mention"; value: string }> = []
  let last = 0
  const re = /@([^\s@]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(display)) !== null) {
    if (m.index > last)
      parts.push({ kind: "text", value: display.slice(last, m.index) })
    const name = m[1]!
    const idx = pending.findIndex((x) => x.name === name)
    if (idx >= 0) {
      pending.splice(idx, 1)
      parts.push({ kind: "mention", value: name })
    } else {
      parts.push({ kind: "text", value: m[0] })
    }
    last = m.index + m[0].length
  }
  if (last < display.length)
    parts.push({ kind: "text", value: display.slice(last) })
  if (parts.length === 0) return display
  return parts.map((part, index) =>
    part.kind === "mention" ? (
      <span
        key={`m-${index}`}
        className="font-semibold text-neutral-900 underline decoration-neutral-900 underline-offset-2"
      >
        @{part.value}
      </span>
    ) : (
      <span key={`t-${index}`}>{part.value}</span>
    )
  )
}
