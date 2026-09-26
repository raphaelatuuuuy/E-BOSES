"use client"

import type { ReactNode } from "react"
import type { PublicUser } from "@/features/dashboard/api"

export type MentionUser = {
  id: number
  full_name: string
}

/** Storage format: `@[FirstName](u:123)` — saved body / API only */
export const MENTION_TOKEN_RE = /@\[([^\]]+)\]\(u:(\d+)\)/g

export type MentionRef = { name: string; id: number }

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
export function reconcileStack(display: string, prev: MentionRef[]): MentionRef[] {
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
  const re = new RegExp(MENTION_TOKEN_RE.source, "g")
  const parts: Array<{ kind: "text" | "mention"; value: string }> = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(body)) !== null) {
    if (match.index > last) parts.push({ kind: "text", value: body.slice(last, match.index) })
    parts.push({ kind: "mention", value: match[1] ?? "" })
    last = match.index + match[0].length
  }
  if (last < body.length) parts.push({ kind: "text", value: body.slice(last) })
  if (parts.length === 0) return body
  return parts.map((part, index) =>
    part.kind === "mention" ? (
      <span
        key={`m-${index}`}
        className="font-semibold text-neutral-900 underline underline-offset-2 decoration-neutral-900"
      >
        @{part.value}
      </span>
    ) : (
      <span key={`t-${index}`}>{part.value}</span>
    ),
  )
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
  for (const c of post.comments ?? []) {
    add(c.author)
    for (const r of c.replies ?? []) add(r.author)
  }
  return [...map.values()]
}
