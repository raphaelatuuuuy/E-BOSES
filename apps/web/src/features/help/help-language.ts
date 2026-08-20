import { createContext, useContext } from "react"

export type HelpLocale = "en" | "fil"

export interface HelpLanguage {
  code: HelpLocale
  native: string
  english: string
}

export const HELP_LANGUAGES: HelpLanguage[] = [
  { code: "en", native: "English", english: "English" },
  { code: "fil", native: "Filipino", english: "Filipino" },
]

export const HELP_LOCALE_STORAGE_KEY = "eboses_help_locale"

const UI_TEXT = {
  en: {
    helpCenter: "Help Center",
    signIn: "Sign in",
    searchPlaceholder: "Search for articles...",
    searchLabel: "Search help articles",
    clearSearch: "Clear search",
    noResults: "No articles matched that search.",
    allCollections: "All Collections",
    notFound: "That article does not exist",
    notFoundTopic: "That topic does not exist",
    renamed: "It may have been renamed.",
    browseAll: "Browse all topics",
    article: "article",
    articles: "articles",
    updated: "Updated",
    moreIn: "More in",
    home: "Home",
    hotline: "Contact your barangay hall",
    selectLanguage: "Select language",
    languageSearch: "Search",
    noLanguages: "No language matched that search.",
    englishOnly: "This article is available in English only.",
  },
  fil: {
    helpCenter: "Help Center",
    signIn: "Mag-sign in",
    searchPlaceholder: "Maghanap ng artikulo...",
    searchLabel: "Maghanap sa mga artikulo ng tulong",
    clearSearch: "Burahin ang hinahanap",
    noResults: "Walang artikulong tumugma sa hinanap.",
    allCollections: "Lahat ng Paksa",
    notFound: "Wala ang artikulong ito",
    notFoundTopic: "Wala ang paksang ito",
    renamed: "Maaaring napalitan ang pangalan nito.",
    browseAll: "Tingnan ang lahat ng paksa",
    article: "artikulo",
    articles: "na artikulo",
    updated: "Na-update",
    moreIn: "Iba pa sa",
    home: "Home",
    hotline: "Makipag-ugnayan sa inyong barangay hall",
    selectLanguage: "Pumili ng wika",
    languageSearch: "Maghanap",
    noLanguages: "Walang wikang tumugma sa hinanap.",
    englishOnly: "Ang artikulong ito ay nasa Ingles lamang.",
  },
}

export type HelpUiText = (typeof UI_TEXT)["en"]

interface HelpLanguageValue {
  locale: HelpLocale
  setLocale: (next: HelpLocale) => void
  t: HelpUiText
}

export const HelpLanguageContext = createContext<HelpLanguageValue | null>(null)

export const HELP_UI_TEXT = UI_TEXT

export function readStoredLocale(): HelpLocale {
  try {
    const stored = localStorage.getItem(HELP_LOCALE_STORAGE_KEY)
    if (stored === "en" || stored === "fil") return stored
  } catch {
    return "en"
  }
  return "en"
}

export function useHelpLanguage() {
  const value = useContext(HelpLanguageContext)
  if (!value) throw new Error("useHelpLanguage must be used inside HelpLanguageProvider")
  return value
}
