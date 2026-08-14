import { useEffect, useRef, useState } from "react"
import { CheckIcon, GlobeIcon, SearchIcon, XIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { HELP_LANGUAGES, useHelpLanguage } from "./help-language"

export function HelpLanguagePicker() {
  const { locale, setLocale, t } = useHelpLanguage()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState("")
  const boxRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
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
  }, [open])

  const current = HELP_LANGUAGES.find((item) => item.code === locale) ?? HELP_LANGUAGES[0]!
  const term = filter.trim().toLowerCase()
  const shown = term
    ? HELP_LANGUAGES.filter(
        (item) =>
          item.native.toLowerCase().includes(term) || item.english.toLowerCase().includes(term),
      )
    : HELP_LANGUAGES

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-2 rounded-full bg-neutral-100 px-4 py-2.5 text-[15px] font-medium text-brand-navy transition-colors hover:bg-neutral-200"
      >
        <GlobeIcon className="size-4 shrink-0 text-neutral-500" strokeWidth={2} aria-hidden />
        {current.native}
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={t.selectLanguage}
          className="absolute right-0 top-full z-40 mt-3 w-[24rem] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_16px_48px_rgba(5,13,51,0.16)]"
        >
          <p className="px-6 pb-4 pt-5 text-[20px] font-semibold tracking-tight text-brand-navy">
            {t.selectLanguage}
          </p>

          <div className="max-h-[22rem] overflow-y-auto border-y border-neutral-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {shown.length === 0 ? (
              <p className="px-6 py-6 text-[15px] text-neutral-500">{t.noLanguages}</p>
            ) : (
              shown.map((item) => {
                const selected = item.code === locale
                return (
                  <button
                    key={item.code}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      setLocale(item.code)
                      setOpen(false)
                      setFilter("")
                    }}
                    className={cn(
                      "flex w-full items-center gap-4 border-b border-neutral-200 px-6 py-5 text-left transition-colors last:border-b-0",
                      selected ? "bg-neutral-50" : "hover:bg-neutral-50",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[19px] font-medium leading-snug text-brand-navy">
                        {item.native}
                      </span>
                      <span className="mt-1 block truncate text-[15px] text-neutral-500">
                        {item.english}
                      </span>
                    </span>
                    {selected ? (
                      <CheckIcon
                        className="size-6 shrink-0 text-brand-navy"
                        strokeWidth={2.4}
                        aria-hidden
                      />
                    ) : null}
                  </button>
                )
              })
            )}
          </div>

          <div className="flex items-center gap-3 px-6 py-4">
            <SearchIcon className="size-5 shrink-0 text-neutral-400" strokeWidth={2} aria-hidden />
            <input
              ref={filterRef}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t.languageSearch}
              aria-label={t.languageSearch}
              className="min-w-0 flex-1 bg-transparent text-[17px] text-brand-navy outline-none placeholder:text-neutral-400"
            />
            {filter ? (
              <button
                type="button"
                onClick={() => {
                  setFilter("")
                  filterRef.current?.focus()
                }}
                aria-label={t.clearSearch}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-brand-navy"
              >
                <XIcon className="size-6" strokeWidth={2.2} aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
