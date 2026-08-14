import { useCallback, useEffect, useState, type ReactNode } from "react"

import {
  HELP_LOCALE_STORAGE_KEY,
  HELP_UI_TEXT,
  HelpLanguageContext,
  readStoredLocale,
  type HelpLocale,
} from "./help-language"

export function HelpLanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<HelpLocale>(readStoredLocale)

  useEffect(() => {
    try {
      localStorage.setItem(HELP_LOCALE_STORAGE_KEY, locale)
    } catch {
      return
    }
  }, [locale])

  const setLocale = useCallback((next: HelpLocale) => setLocaleState(next), [])

  return (
    <HelpLanguageContext.Provider value={{ locale, setLocale, t: HELP_UI_TEXT[locale] }}>
      {children}
    </HelpLanguageContext.Provider>
  )
}
