import { HELP_COLLECTIONS, pick, type HelpArticle, type HelpCollection } from "./help-content"
import type { HelpLocale } from "./help-language"

export interface HelpHit {
  collection: HelpCollection
  article: HelpArticle
}

function bodyText(article: HelpArticle, locale: HelpLocale) {
  return article.blocks
    .map((block) =>
      block.kind === "steps" || block.kind === "list"
        ? block.items.map((item) => pick(item, locale)).join(" ")
        : pick(block.body, locale),
    )
    .join(" ")
}

function articleText(article: HelpArticle, locale: HelpLocale) {
  return `${pick(article.title, locale)} ${pick(article.subtitle, locale)} ${bodyText(article, locale)}`.toLowerCase()
}

export function snippetFor(
  article: HelpArticle,
  terms: string[],
  locale: HelpLocale = "en",
  max = 150,
): string {
  const body = bodyText(article, locale)
  if (!body) return ""

  const lowered = body.toLowerCase()
  let at = -1
  for (const term of terms) {
    const found = lowered.indexOf(term.toLowerCase())
    if (found >= 0 && (at < 0 || found < at)) at = found
  }
  if (at < 0) return body.slice(0, max).trim() + (body.length > max ? "..." : "")

  const start = Math.max(0, at - 40)
  const slice = body.slice(start, start + max).trim()
  return `${start > 0 ? "..." : ""}${slice}${start + max < body.length ? "..." : ""}`
}

export function searchHelp(query: string, locale: HelpLocale = "en", limit = 8): HelpHit[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  const hits: Array<HelpHit & { score: number }> = []
  for (const collection of HELP_COLLECTIONS) {
    for (const article of collection.articles) {
      const haystack = articleText(article, locale)
      const title = pick(article.title, locale).toLowerCase()
      let score = 0
      for (const term of terms) {
        if (title.includes(term)) score += 3
        else if (haystack.includes(term)) score += 1
        else {
          score = 0
          break
        }
      }
      if (score > 0) hits.push({ collection, article, score })
    }
  }

  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ collection, article }) => ({ collection, article }))
}
