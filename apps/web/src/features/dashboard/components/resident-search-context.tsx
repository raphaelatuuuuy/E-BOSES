import * as React from "react"

type ResidentSearchContextValue = {
  search: string
  setSearch: (value: string) => void
}

const ResidentSearchContext = React.createContext<ResidentSearchContextValue | null>(null)

export function ResidentSearchProvider({ children }: { children: React.ReactNode }) {
  const [search, setSearch] = React.useState("")
  const value = React.useMemo(() => ({ search, setSearch }), [search])
  return (
    <ResidentSearchContext.Provider value={value}>{children}</ResidentSearchContext.Provider>
  )
}

export function useResidentSearch() {
  const ctx = React.useContext(ResidentSearchContext)
  if (!ctx) {
    return {
      search: "",
      setSearch: (_: string) => {},
    }
  }
  return ctx
}
