import { Link, useParams } from "react-router-dom"

import { HELP_COLLECTIONS, findArticle, findCollection, pick } from "./help-content"
import { useHelpLanguage } from "./help-language"
import { HelpLanguagePicker } from "./help-language-picker"
import { HelpLanguageProvider } from "./help-language-provider"

function NativeHelpContent() {
  const { articleSlug, collectionSlug } = useParams()
  const { locale, t } = useHelpLanguage()
  const found = findArticle(articleSlug)
  const collection = findCollection(collectionSlug)
  const missing = Boolean((articleSlug && !found) || (collectionSlug && !collection))
  const collections = collection ? [collection] : HELP_COLLECTIONS

  return (
    <main className="mx-auto min-h-svh max-w-3xl px-5 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <img src="/contents/logo.webp" alt="E-Boses" className="size-9 object-contain" />
          {t.home}
        </Link>
        <HelpLanguagePicker />
      </header>
      <nav aria-label={t.helpCenter} className="flex flex-wrap gap-3 py-5 text-sm underline underline-offset-4">
        <Link to="/help">{t.helpCenter}</Link>
        {found ? (
          <Link to={`/help/collections/${found.collection.slug}`}>
            {pick(found.collection.title, locale)}
          </Link>
        ) : null}
      </nav>
      {missing ? (
        <h1 className="text-2xl font-semibold">{t.notFound}</h1>
      ) : found ? (
        <article>
          <h1 className="text-2xl font-semibold">{pick(found.article.title, locale)}</h1>
          <p className="mt-3 text-muted-foreground">{pick(found.article.subtitle, locale)}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t.updated}: {pick(found.article.updated, locale)}</p>
          <div className="mt-6 space-y-5 leading-relaxed">
            {found.article.blocks.map((block, index) => {
              if (block.kind === "steps" || block.kind === "list") {
                const List = block.kind === "steps" ? "ol" : "ul"
                return (
                  <List key={index} className={`ml-5 space-y-2 ${block.kind === "steps" ? "list-decimal" : "list-disc"}`}>
                    {block.items.map((item) => <li key={item.en}>{pick(item, locale)}</li>)}
                  </List>
                )
              }
              return (
                <p key={index} className={block.kind === "note" ? "rounded-lg bg-muted p-4" : undefined}>
                  {pick(block.body, locale)}
                </p>
              )
            })}
          </div>
        </article>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{collection ? pick(collection.title, locale) : t.helpCenter}</h1>
          <div className="mt-6 space-y-8">
            {collections.map((item) => (
              <section key={item.slug}>
                <h2 className="text-lg font-semibold">{pick(item.title, locale)}</h2>
                <ul className="mt-3 divide-y">
                  {item.articles.map((article) => (
                    <li key={article.slug}>
                      <Link to={`/help/articles/${article.slug}`} className="block py-4 underline underline-offset-4">
                        {pick(article.title, locale)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  )
}

export default function NativeHelp() {
  return (
    <HelpLanguageProvider>
      <NativeHelpContent />
    </HelpLanguageProvider>
  )
}
