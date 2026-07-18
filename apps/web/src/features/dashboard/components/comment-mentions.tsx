"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

import { searchResidentsForMention } from "@/features/auth/api"
import type { PublicUser } from "@/features/dashboard/api"

export type MentionUser = {
  id: number
  full_name: string
}

/** Storage format: `@[FirstName](u:123)` — saved body / API only */
export const MENTION_TOKEN_RE = /@\[([^\]]+)\]\(u:(\d+)\)/g

type MentionRef = { name: string; id: number }

export function firstNameOf(fullName: string) {
  const part = fullName.trim().split(/\s+/)[0]
  return part || fullName.trim() || "Neighbor"
}

export function mentionToken(user: MentionUser) {
  return `@[${firstNameOf(user.full_name)}](u:${user.id})`
}

export function toMentionUser(user: {
  id: number
  full_name?: string
  firstName?: string
  lastName?: string
}): MentionUser {
  const full =
    user.full_name?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    `User ${user.id}`
  return { id: user.id, full_name: full }
}

export function extractMentionStack(storage: string): MentionRef[] {
  return [...storage.matchAll(new RegExp(MENTION_TOKEN_RE.source, "g"))].map((m) => ({
    name: m[1]!,
    id: Number(m[2]!),
  }))
}

/** Storage → composer display (`@Raphael`, never `@[Raphael](u:7)`) */
export function storageToDisplay(storage: string): string {
  return storage.replace(new RegExp(MENTION_TOKEN_RE.source, "g"), "@$1")
}

/** Display → storage; re-attaches ids from the mention stack in order. */
export function displayToStorage(display: string, stack: MentionRef[]): string {
  if (stack.length === 0) return display
  const pending = [...stack]
  return display.replace(/@([^\s@]+)/g, (full, name: string) => {
    const idx = pending.findIndex((m) => m.name === name)
    if (idx < 0) return full
    const [m] = pending.splice(idx, 1)
    if (!m) return full
    return `@[${m.name}](u:${m.id})`
  })
}

/** Keep only mentions still present as `@Name` in display (in order). */
function reconcileStack(display: string, prev: MentionRef[]): MentionRef[] {
  if (prev.length === 0) return []
  const pending = [...prev]
  const next: MentionRef[] = []
  const re = /@([^\s@]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(display)) !== null) {
    const name = m[1]!
    const idx = pending.findIndex((x) => x.name === name)
    if (idx < 0) continue
    const [hit] = pending.splice(idx, 1)
    if (hit) next.push(hit)
  }
  return next
}

/** Posted comments: show @Name bold+underline (no raw token). */
export function renderCommentBody(body: string): ReactNode {
  const nodes: ReactNode[] = []
  const re = new RegExp(MENTION_TOKEN_RE.source, "g")
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = re.exec(body)) !== null) {
    if (match.index > last) {
      nodes.push(<span key={`t-${key++}`}>{body.slice(last, match.index)}</span>)
    }
    const name = match[1]
    nodes.push(
      <span
        key={`m-${key++}`}
        className="font-semibold text-neutral-900 underline underline-offset-2 decoration-neutral-900"
      >
        @{name}
      </span>,
    )
    last = match.index + match[0].length
  }
  if (last < body.length) {
    nodes.push(<span key={`t-${key++}`}>{body.slice(last)}</span>)
  }
  if (nodes.length === 0) return body
  return nodes
}

/**
 * Active `@query` for suggestions. Ignores committed `@Name` that map to stack.
 */
export function findActiveMention(
  display: string,
  cursor: number,
  stack: MentionRef[],
): { start: number; query: string } | null {
  const before = display.slice(0, cursor)
  const at = before.lastIndexOf("@")
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1] ?? "")) return null

  const afterAt = before.slice(at + 1)
  if (afterAt.includes(" ") || afterAt.includes("\n") || afterAt.includes("[")) return null

  // If this @Name is already a committed mention and cursor is within/at end of it, skip
  const nameMatch = afterAt.match(/^([^\s@]+)$/)
  if (nameMatch) {
    const name = nameMatch[1]!
    const tokenEnd = at + 1 + name.length
    if (cursor <= tokenEnd) {
      const prefix = display.slice(0, tokenEnd)
      const hits = reconcileStack(prefix, stack)
      if (hits.some((h) => h.name === name)) {
        // Committed mention — only reopen if user is still "typing" a longer query
        // which they can't if query === full name and it's committed
        return null
      }
    }
  }

  return { start: at, query: afterAt }
}

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
  const [stack, setStack] = useState<MentionRef[]>(() => extractMentionStack(value))

  // Parent reset / reply prefill (storage tokens → short display)
  useEffect(() => {
    setDisplay(storageToDisplay(value))
    setStack(extractMentionStack(value))
  }, [value])

  function emit(nextDisplay: string, nextStack: MentionRef[]) {
    setDisplay(nextDisplay)
    setStack(nextStack)
    onChange(displayToStorage(nextDisplay, nextStack))
  }

  const active = useMemo(
    () => findActiveMention(display, cursor, stack),
    [display, cursor, stack],
  )

  useEffect(() => {
    if (!active) {
      setRemoteUsers([])
      return
    }
    const q = active.query
    const t = window.setTimeout(() => {
      void searchResidentsForMention(q || undefined)
        .then((rows) => {
          setRemoteUsers(
            rows.map((r) =>
              toMentionUser({
                id: r.id,
                full_name: r.full_name,
                firstName: r.firstName,
                lastName: r.lastName,
              }),
            ),
          )
        })
        .catch(() => setRemoteUsers([]))
    }, q ? 180 : 0)
    return () => window.clearTimeout(t)
  }, [active?.query, active?.start])

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

  useEffect(() => {
    setHighlight(0)
  }, [suggestions.length, active?.query])

  function insertMention(user: MentionUser) {
    if (!active) return
    const name = firstNameOf(user.full_name)
    const insert = `@${name} `
    const nextDisplay = display.slice(0, active.start) + insert + display.slice(cursor)

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
            !display && "invisible",
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
              setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length)
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
          inputClassName,
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
                  i === highlight ? "bg-neutral-100" : "hover:bg-neutral-50",
                )}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(u)
                }}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#c5d0e6] text-[12px] font-semibold text-[#2c3a5a]">
                  {firstNameOf(u.full_name)[0]?.toUpperCase() ?? "?"}
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

function renderDisplayHighlight(display: string, stack: MentionRef[]): ReactNode {
  if (!display) return "\u00a0"
  const pending = [...stack]
  const nodes: ReactNode[] = []
  let last = 0
  let key = 0
  const re = /@([^\s@]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(display)) !== null) {
    if (m.index > last) {
      nodes.push(<span key={`t-${key++}`}>{display.slice(last, m.index)}</span>)
    }
    const name = m[1]!
    const idx = pending.findIndex((x) => x.name === name)
    if (idx >= 0) {
      pending.splice(idx, 1)
      nodes.push(
        <span
          key={`m-${key++}`}
          className="font-semibold text-neutral-900 underline underline-offset-2 decoration-neutral-900"
        >
          @{name}
        </span>,
      )
    } else {
      nodes.push(<span key={`t-${key++}`}>{m[0]}</span>)
    }
    last = m.index + m[0].length
  }
  if (last < display.length) {
    nodes.push(<span key={`t-${key++}`}>{display.slice(last)}</span>)
  }
  return nodes.length ? nodes : display
}

export function collectThreadMentionUsers(
  post: {
    reporter: PublicUser
    comments: { author: PublicUser; replies: { author: PublicUser }[] }[]
  },
  sessionUser: PublicUser | null,
): MentionUser[] {
  const map = new Map<number, MentionUser>()
  const add = (u?: PublicUser | null) => {
    if (!u?.id) return
    const name = (u.full_name || "").trim()
    if (!name) return
    map.set(u.id, { id: u.id, full_name: name })
  }
  add(post.reporter)
  add(sessionUser)
  for (const c of post.comments) {
    add(c.author)
    for (const r of c.replies) add(r.author)
  }
  return [...map.values()]
}
