import { Link, useParams } from "react-router-dom"
import { ChevronRightIcon, InfoIcon } from "lucide-react"

import { findArticle, pick, type HelpBlock } from "./help-content"
import { useHelpLanguage, type HelpLocale } from "./help-language"
import { HelpBreadcrumb, HelpShell } from "./help-shell"

function Block({ block, locale }: { block: HelpBlock; locale: HelpLocale }) {
  if (block.kind === "steps") {
    return (
      <ol className="ml-5 list-decimal space-y-2 text-[17px] leading-relaxed text-neutral-700 marker:font-semibold marker:text-neutral-400">
        {block.items.map((item) => (
          <li key={item.en}>{pick(item, locale)}</li>
        ))}
      </ol>
    )
  }
  if (block.kind === "list") {
    return (
      <ul className="ml-5 list-disc space-y-2 text-[17px] leading-relaxed text-neutral-700 marker:text-neutral-300">
        {block.items.map((item) => (
          <li key={item.en}>{pick(item, locale)}</li>
        ))}
      </ul>
    )
  }
  if (block.kind === "note") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-brand-orange-soft bg-brand-orange-soft/60 px-4 py-3">
        <InfoIcon className="size-6 shrink-0 text-accent" strokeWidth={2.2} aria-hidden />
        <p className="text-[17px] leading-relaxed text-neutral-700">{pick(block.body, locale)}</p>
      </div>
    )
  }
  return <p className="text-[17px] leading-relaxed text-neutral-700">{pick(block.body, locale)}</p>
}

function ArticleBody({ slug }: { slug: string | undefined }) {
  const { locale, t } = useHelpLanguage()
  const found = findArticle(slug)

  if (!found) {
    return (
      <>
        <HelpBreadcrumb trail={[{ label: t.allCollections, to: "/help" }, { label: t.notFound }]} />
        <h1 className="mt-6 text-3xl font-bold text-brand-navy">{t.notFound}</h1>
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

  const { collection, article } = found
  const others = collection.articles.filter((item) => item.slug !== article.slug)

  return (
    <>
      <HelpBreadcrumb
        trail={[
          { label: t.allCollections, to: "/help" },
          { label: pick(collection.title, locale), to: `/help/collections/${collection.slug}` },
          { label: pick(article.title, locale) },
        ]}
      />

      <article className="mt-8 max-w-4xl">
        <h1 className="text-[34px] font-bold leading-tight text-brand-navy sm:text-[42px]">
          {pick(article.title, locale)}
        </h1>
        <p className="mt-4 text-[18px] leading-relaxed text-neutral-500">
          {pick(article.subtitle, locale)}
        </p>
        <p className="mt-2 text-[15px] text-neutral-400">
          {t.updated}: {pick(article.updated, locale)}
        </p>

        <div className="mt-10 space-y-6">
          {article.blocks.map((block, index) => (
            <Block key={index} block={block} locale={locale} />
          ))}
        </div>
      </article>

      {others.length > 0 ? (
        <section className="mt-20 max-w-4xl border-t border-neutral-200 pt-10">
          <h2 className="text-sm text-neutral-400">
            {t.moreIn} {pick(collection.title, locale)}
          </h2>
          <ul className="mt-3 overflow-hidden rounded-xl border border-neutral-200">
            {others.map((item) => (
              <li key={item.slug} className="border-b border-neutral-200 last:border-b-0">
                <Link
                  to={`/help/articles/${item.slug}`}
                  className="flex items-center gap-4 px-6 py-5 no-underline transition-colors hover:bg-neutral-100"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[16px] font-medium leading-snug text-neutral-900">
                      {pick(item.title, locale)}
                    </p>
                    <p className="mt-1 text-[14px] leading-relaxed text-neutral-500">
                      {pick(item.subtitle, locale)}
                    </p>
                  </div>
                  <ChevronRightIcon
                    className="size-5 shrink-0 text-neutral-400"
                    strokeWidth={1.8}
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

export default function HelpArticlePage() {
  const { articleSlug } = useParams()
  return (
    <HelpShell>
      <ArticleBody slug={articleSlug} />
    </HelpShell>
  )
}
