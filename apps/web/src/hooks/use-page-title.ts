import { useEffect } from "react"

interface UsePageTitleOptions {
  suffix?: string
}

export function usePageTitle(title: string, options: UsePageTitleOptions = {}) {
  const { suffix = "E-Boses" } = options

  useEffect(() => {
    document.title = `${title} | ${suffix}`
  }, [suffix, title])
}
