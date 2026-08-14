import { Link } from "react-router-dom"

import { HELP_COLLECTIONS, pick } from "./help-content"
import { useHelpLanguage } from "./help-language"
import { HelpShell } from "./help-shell"

function HelpGrid() {
  const { locale, t } = useHelpLanguage()

  return (
    <>
      <div className="grid grid-cols-1 gap-x-10 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
        {HELP_COLLECTIONS.map((collection) => {
          const Icon = collection.icon
          return (
            <Link
              key={collection.slug}
              to={`/help/c/${collection.slug}`}
              className="group flex items-start gap-6 no-underline"
            >
              <span className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-brand-navy text-white transition-[background-color,box-shadow] duration-200 ease-out group-hover:bg-accent group-hover:shadow-lg motion-reduce:transition-none">
                <Icon
                  className="size-9 transition-transform duration-200 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                  strokeWidth={1.7}
                  aria-hidden
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[22px] font-bold leading-tight text-brand-navy transition-colors group-hover:text-accent">
                  {pick(collection.title, locale)}
                </p>
                <p className="mt-2 text-[16px] leading-relaxed text-neutral-500">
                  {pick(collection.description, locale)}
                </p>
              </div>
            </Link>
          )
        })}
      </div>

      <footer className="mt-28 border-t border-neutral-200 pt-10">
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-base text-neutral-500">
          <Link to="/" className="no-underline transition-colors hover:text-accent">
            {t.home}
          </Link>
          <Link to="/sign-in" className="no-underline transition-colors hover:text-accent">
            {t.signIn}
          </Link>
          <span>{t.hotline}</span>
        </div>
      </footer>
    </>
  )
}

export default function HelpPage() {
  return (
    <HelpShell>
      <HelpGrid />
    </HelpShell>
  )
}
