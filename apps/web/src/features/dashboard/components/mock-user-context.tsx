"use client"

import * as React from "react"

export interface MockUser {
  firstName: string
  lastName: string
  role: string
}

const MOCK_USER: MockUser = {
  firstName: "Juan",
  lastName: "Dela Cruz",
  role: "Resident",
}

const MockUserContext = React.createContext<MockUser | null>(null)

export function useMockUser(): MockUser {
  const ctx = React.useContext(MockUserContext)
  if (!ctx) throw new Error("useMockUser must be used within MockUserProvider")
  return ctx
}

export function MockUserProvider({ children }: { children: React.ReactNode }) {
  return (
    <MockUserContext.Provider value={MOCK_USER}>
      {children}
    </MockUserContext.Provider>
  )
}
