import { Link, useParams } from "react-router-dom"
import { ChevronRightIcon } from "lucide-react"

import { findCollection, pick } from "./help-content"
import { useHelpLanguage } from "./help-language"
import { HelpBreadcrumb, HelpShell } from "./help-shell"

function CollectionBody({ slug }: { slug: string | undefined }) {
  const { locale, t } = useHelpLanguage()
  const collection = findCollection(slug)

  if (!collection) {
    return (
      <>
        <HelpBreadcrumb trail={[{ label: t.allCollections, to: "/help" }, { label: t.notFoundTopic }]} />
        <h1 className="mt-6 text-3xl font-bold text-brand-navy">{t.notFoundTopic}</h1>
        <p className="mt-3 text-neutral-500">
          {t.renamed}{" "}
          <Link to="/help" className="font-semibold text-accent no-underline">
            {t.browseAll}
          </Link>
          .
        </p>
      </>
    )
  }

  const Icon = collection.icon
  const count = collection.articles.length

  return (
    <>
      <HelpBreadcrumb
        trail={[{ label: t.allCollections, to: "/help" }, { label: pick(collection.title, locale) }]}
      />

      <div className="mt-8 flex items-center gap-6">
        <span className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-brand-navy text-white">
          <Icon className="size-9" strokeWidth={1.7} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[32px] font-bold leading-tight text-brand-navy sm:text-[38px]">
            {pick(collection.title, locale)}
          </h1>
          <p className="mt-2 text-[17px] leading-relaxed text-neutral-500">
            {pick(collection.description, locale)}
          </p>
        </div>
      </div>

      <p className="mt-14 text-[15px] text-neutral-400">
        {count} {count === 1 ? t.article : t.articles}
      </p>

      <ul className="mt-3 overflow-hidden rounded-xl border border-neutral-200">
        {collection.articles.map((article) => (
          <li key={article.slug} className="border-b border-neutral-200 last:border-b-0">
            <Link
              to={`/help/a/${article.slug}`}
              className="flex items-center gap-4 px-8 py-7 no-underline transition-colors hover:bg-neutral-100"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[19px] font-medium leading-snug text-neutral-900">
                  {pick(article.title, locale)}
                </p>
                <p className="mt-2 text-[16px] leading-relaxed text-neutral-500">
                  {pick(article.subtitle, locale)}
                </p>
              </div>
              <ChevronRightIcon
                className="size-6 shrink-0 text-neutral-400"
                strokeWidth={1.7}
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

export default function HelpCollectionPage() {
  const { collectionSlug } = useParams()
  return (
    <HelpShell>
      <CollectionBody slug={collectionSlug} />
    </HelpShell>
  )
}
