import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link, useNavigate } from "react-router-dom"
import { ChevronRightIcon, SearchIcon, XIcon } from "lucide-react"

import { pick } from "./help-content"
import { useHelpLanguage } from "./help-language"
import { HelpLanguageProvider } from "./help-language-provider"
import { HelpLanguagePicker } from "./help-language-picker"
import { searchHelp, snippetFor } from "./help-search"

function HelpShellInner({ children }: { children: ReactNode }) {
  const { locale, t } = useHelpLanguage()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const terms = query.trim().split(/\s+/).filter(Boolean)
  const hits = searchHelp(query, locale)
  const showResults = open && query.trim().length > 0

  useEffect(() => {
    if (!showResults) return
    const onPointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !boxRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [showResults])

  return (
    <div className="min-h-svh bg-white text-brand-navy">
      <div className="mx-auto w-full max-w-[1340px] px-6 pb-28 pt-[max(3rem,env(safe-area-inset-top))] sm:px-12 lg:px-16">
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <img src="/contents/logo.webp" alt="E-Boses" className="h-9 w-auto shrink-0 object-contain sm:h-12" />
            <span className="flex min-w-0 flex-col leading-none min-[420px]:flex-row min-[420px]:items-baseline min-[420px]:gap-2">
              <span className="truncate text-lg font-bold text-accent sm:text-2xl">Boses</span>
              <span className="truncate text-[13px] font-semibold text-neutral-400 sm:text-2xl">{t.helpCenter}</span>
            </span>
          </Link>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <HelpLanguagePicker />
            <Link
              to="/sign-in"
              className="whitespace-nowrap rounded-full px-2 py-2 text-sm font-semibold text-brand-navy underline decoration-accent decoration-2 underline-offset-4 transition-colors hover:text-accent sm:px-4 sm:text-base"
            >
              {t.signIn}
            </Link>
          </div>
        </header>

        <div ref={boxRef} className="relative mt-14">
          <div className="flex items-center gap-4 border-b border-neutral-300 pb-4">
            <SearchIcon className="size-6 shrink-0 text-neutral-400" strokeWidth={2} aria-hidden />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setOpen(true)
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && hits[0]) {
                  event.preventDefault()
                  setOpen(false)
                  navigate(`/help/articles/${hits[0].article.slug}`)
                }
              }}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchLabel}
              className="h-12 min-w-0 flex-1 bg-transparent text-[20px] text-brand-navy outline-none placeholder:text-neutral-400"
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("")
                  setOpen(false)
                  inputRef.current?.focus()
                }}
                aria-label={t.clearSearch}
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-brand-navy"
              >
                <XIcon className="size-7" strokeWidth={2} aria-hidden />
              </button>
            ) : null}
          </div>

          {showResults ? (
            <div className="absolute inset-x-0 top-full z-30 mt-4 max-h-[28rem] space-y-4 overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-4 shadow-[0_16px_48px_rgba(5,13,51,0.14)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {hits.length === 0 ? (
                <p className="px-2 py-6 text-center text-[15px] text-neutral-500">{t.noResults}</p>
              ) : (
                hits.map((hit) => (
                  <Link
                    key={hit.article.slug}
                    to={`/help/articles/${hit.article.slug}`}
                    onClick={() => setOpen(false)}
                    className="block rounded-2xl border border-neutral-200 px-6 py-5 no-underline transition-colors hover:border-brand-navy/25 hover:bg-neutral-50"
                  >
                    <p className="text-[19px] font-semibold leading-snug text-brand-navy">
                      {pick(hit.article.title, locale)}
                    </p>
                    <p className="mt-2 text-[15px] leading-relaxed text-neutral-500">
                      {pick(hit.article.subtitle, locale)}
                    </p>
                    <p className="mt-1.5 text-[15px] leading-relaxed text-neutral-500">
                      {snippetFor(hit.article, terms, locale)}
                    </p>
                  </Link>
                ))
              )}
            </div>
          ) : null}
        </div>

        <main className="mt-16">{children}</main>
      </div>
    </div>
  )
}

export function HelpShell({ children }: { children: ReactNode }) {
  return (
    <HelpLanguageProvider>
      <HelpShellInner>{children}</HelpShellInner>
    </HelpLanguageProvider>
  )
}

export function HelpBreadcrumb({ trail }: { trail: Array<{ label: string; to?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[14px]">
      {trail.map((crumb, index) => (
        <span key={crumb.label} className="flex items-center gap-2">
          {index > 0 ? (
            <ChevronRightIcon
              className="size-3.5 shrink-0 text-neutral-300"
              strokeWidth={2.4}
              aria-hidden
            />
          ) : null}
          {crumb.to ? (
            <Link
              to={crumb.to}
              className="text-neutral-500 no-underline transition-colors hover:text-accent"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className="text-neutral-400">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
