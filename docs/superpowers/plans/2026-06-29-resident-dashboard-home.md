# Resident Dashboard Home — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the resident dashboard Home page with dark navy sidebar, profile expandable, topbar, and glassmorphism greeting card.

**Architecture:** 3 new components (MockUserProvider, Topbar, GreetingCard) and 2 modified components (Sidebar, HomePage). MockUserProvider wraps the dashboard content so both Sidebar and GreetingCard consume the same user data. Topbar and GreetingCard are slotted into HomePage.

**Tech Stack:** React 19, TypeScript, Tailwind v4, lucide-react, `@workspace/ui/lib/utils` (cn utility), `@workspace/ui/styles/globals.css` CSS variables.

## Global Constraints

- Brand navy: `#020c4e` — use `bg-[#020c4e]` / `text-white` in sidebar
- White/10 and white/20 for sidebar borders and overlays
- Glass card uses `bg-white/10 backdrop-blur-md border border-white/20`
- Border radius: `rounded-xl` for glass card, `rounded-full` for avatar
- Sidebar widths: expanded = 240px (`w-60`), collapsed = 64px (`w-16`)
- All heading fonts use `font-heading` (Clash Display)
- Filipino date/month names via hardcoded lookup tables (no locale API)
- Time-of-day greeting thresholds: 5-11 umaga, 12 tanghali, 13-17 hapon, 18-4 gabi
- Mock user: firstName="Juan", lastName="Dela Cruz", role="Resident"

---
### Task 1: Create MockUserProvider

**Files:**
- Create: `apps/web/src/features/dashboard/components/mock-user-context.tsx`

**Interfaces:**
- Produces:
  - `interface MockUser { firstName: string; lastName: string; role: string }`
  - `useMockUser(): MockUser` — hook
  - `MockUserProvider({ children }: { children: React.ReactNode })` — component

- [ ] **Step 1: Create the context file**

```tsx
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
```

- [ ] **Step 2: Type-check**

```bash
cd /c/Users/TO\ GOD\ BE\ THE\ GLORY/Documents/S.Y.\ 2025-2026/CAPSTONE/Main && npx tsc --noEmit -p apps/web/tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/dashboard/components/mock-user-context.tsx
git commit -m "feat: create MockUserProvider with mock resident data"
```

---
### Task 2: Create Topbar Component

**Files:**
- Create: `apps/web/src/features/dashboard/components/topbar.tsx`

**Interfaces:**
- Consumes: nothing (self-contained)
- Produces: `Topbar()` — stateless component

- [ ] **Step 1: Create the Topbar component**

```tsx
import { BellIcon, PlusIcon, SearchIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

export function Topbar() {
  return (
    <div className="flex h-16 items-center justify-between px-6">
      {/* Left: Search */}
      <div className="relative flex items-center">
        <SearchIcon className="absolute left-3 size-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search"
          className={cn(
            "w-64 bg-transparent py-2 pl-10 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground",
            "border-b border-transparent focus:border-border/50 transition-colors",
          )}
        />
      </div>

      {/* Right: Create + Notification */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <PlusIcon className="size-4" />
          Create
        </button>

        <button
          type="button"
          className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <BellIcon className="size-5" />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /c/Users/TO\ GOD\ BE\ THE\ GLORY/Documents/S.Y.\ 2025-2026/CAPSTONE/Main && npx tsc --noEmit -p apps/web/tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/dashboard/components/topbar.tsx
git commit -m "feat: create topbar with search, create button, notification"
```

---
### Task 3: Create GreetingCard Component

**Files:**
- Create: `apps/web/src/features/dashboard/components/greeting-card.tsx`

**Interfaces:**
- Consumes: `useMockUser()` from Task 1
- Produces: `GreetingCard()` — stateless component

- [ ] **Step 1: Create Filipino date utilities and GreetingCard component**

```tsx
import { useMockUser } from "@/features/dashboard/components/mock-user-context"

const FILIPINO_DAYS = [
  "Linggo",
  "Lunes",
  "Martes",
  "Miyerkules",
  "Huwebes",
  "Biyernes",
  "Sabado",
]

const FILIPINO_MONTHS = [
  "Enero",
  "Pebrero",
  "Marso",
  "Abril",
  "Mayo",
  "Hunyo",
  "Hulyo",
  "Agosto",
  "Setyembre",
  "Oktubre",
  "Nobyembre",
  "Disyembre",
]

function getFilipinoGreeting(): string {
  const hour = new Date().getHours()

  if (hour >= 5 && hour <= 11) return "Magandang umaga"
  if (hour === 12) return "Magandang tanghali"
  if (hour >= 13 && hour <= 17) return "Magandang hapon"
  return "Magandang gabi"
}

function getFilipinoDateString(): string {
  const now = new Date()
  const dayName = FILIPINO_DAYS[now.getDay()]
  const monthName = FILIPINO_MONTHS[now.getMonth()]
  const date = now.getDate()
  const year = now.getFullYear()

  return `Brgy. Marikina Heights, ${dayName}, ${monthName} ${date}, ${year}`
}

export function GreetingCard() {
  const user = useMockUser()
  const greeting = getFilipinoGreeting()
  const dateString = getFilipinoDateString()

  return (
    <div className="relative flex h-64 items-center justify-center bg-gradient-to-br from-blue-900/30 to-indigo-900/40">
      {/* Glass card */}
      <div className="mx-auto max-w-lg rounded-xl border border-white/20 bg-white/10 px-8 py-6 text-center backdrop-blur-md">
        <h1 className="font-heading text-3xl font-bold text-white md:text-4xl">
          {greeting}, {user.firstName}
        </h1>
        <p className="mt-2 text-sm font-medium text-white/70">
          {dateString}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /c/Users/TO\ GOD\ BE\ THE\ GLORY/Documents/S.Y.\ 2025-2026/CAPSTONE/Main && npx tsc --noEmit -p apps/web/tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/dashboard/components/greeting-card.tsx
git commit -m "feat: create greeting card with time-based Filipino greeting"
```

---
### Task 4: Modify Sidebar — Dark Navy Theme + Profile Section

**Files:**
- Modify: `apps/web/src/features/dashboard/components/sidebar.tsx`

**Interfaces:**
- Consumes: `useMockUser()` from Task 1
- Sidebar contract unchanged — same `isOpen`, `toggle`, `location`, `navigate`

- [ ] **Step 1: Rewrite sidebar.tsx**

New sidebar:
- Background: `bg-[#020c4e]`, border: `border-white/10`
- Top section replaces logo: avatar (initials fallback circle), full name, "Resident" subtext, clickable expandable with Profile + Sign Out
- Nav items: Home, Feed, Reports, then separator, then Settings + Collapse toggle
- Text: `text-white/60` inactive, `text-white` active, `hover:bg-white/5 hover:text-white/90`
- Active state: `bg-white/10 text-white`

```tsx
import { useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import {
  BarChart3Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  HomeIcon,
  LogOutIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RssIcon,
  SettingsIcon,
  UserIcon,
} from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { useMockUser } from "@/features/dashboard/components/mock-user-context"
import { useSidebar } from "@/features/dashboard/components/sidebar-context"

interface NavItem {
  label: string
  path: string
  icon: React.ElementType
}

const topNavItems: NavItem[] = [
  { label: "Home", path: "/dashboard/home", icon: HomeIcon },
  { label: "Feed", path: "/dashboard/feed", icon: RssIcon },
  { label: "Reports", path: "/dashboard/reports", icon: BarChart3Icon },
]

const bottomNavItems: NavItem[] = [
  { label: "Settings", path: "/dashboard/settings", icon: SettingsIcon },
]

export function Sidebar() {
  const { isOpen, toggle } = useSidebar()
  const location = useLocation()
  const navigate = useNavigate()
  const user = useMockUser()
  const [profileOpen, setProfileOpen] = useState(false)

  function isActive(path: string) {
    return location.pathname === path
  }

  function handleSignOut() {
    navigate("/")
  }

  const initials = `${user.firstName[0]}${user.lastName[0]}`

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 flex h-svh flex-col border-r border-white/10 bg-[#020c4e] transition-all duration-300",
        isOpen ? "w-60" : "w-16",
      )}
    >
      {/* Profile section */}
      <div className="border-b border-white/10">
        <button
          type="button"
          onClick={() => setProfileOpen((prev) => !prev)}
          className={cn(
            "flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-white/5",
            !isOpen && "justify-center px-0",
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white">
            {initials}
          </span>
          {isOpen && (
            <>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  {user.firstName} {user.lastName}
                </p>
                <p className="truncate text-xs text-blue-200/80">
                  {user.role}
                </p>
              </div>
              {profileOpen ? (
                <ChevronUpIcon className="size-4 shrink-0 text-white/60" />
              ) : (
                <ChevronDownIcon className="size-4 shrink-0 text-white/60" />
              )}
            </>
          )}
        </button>

        {/* Expandable submenu */}
        {isOpen && profileOpen && (
          <div className="border-t border-white/10 pb-2 pt-1">
            <Link
              to="/dashboard/profile"
              className="flex items-center gap-3 px-4 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white"
            >
              <UserIcon className="size-4 shrink-0" />
              <span>Profile</span>
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-3 px-4 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white"
            >
              <LogOutIcon className="size-4 shrink-0" />
              <span>Sign out</span>
            </button>
          </div>
        )}
      </div>

      {/* Main navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-1">
          {topNavItems.map((item) => {
            const active = isActive(item.path)
            const Icon = item.icon

            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 rounded-none px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/60 hover:bg-white/5 hover:text-white/90",
                    !isOpen && "justify-center px-0",
                  )}
                >
                  <Icon className="size-5 shrink-0" />
                  {isOpen && <span>{item.label}</span>}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer section */}
      <div className="border-t border-white/10 p-2">
        <ul className="space-y-1">
          {bottomNavItems.map((item) => {
            const active = isActive(item.path)
            const Icon = item.icon

            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 rounded-none px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/60 hover:bg-white/5 hover:text-white/90",
                    !isOpen && "justify-center px-0",
                  )}
                >
                  <Icon className="size-5 shrink-0" />
                  {isOpen && <span>{item.label}</span>}
                </Link>
              </li>
            )
          })}

          {/* Toggle button */}
          <li>
            <button
              type="button"
              onClick={toggle}
              className={cn(
                "flex w-full items-center gap-3 rounded-none px-3 py-2 text-sm font-medium text-white/60 transition-colors hover:bg-white/5 hover:text-white/90",
                !isOpen && "justify-center px-0",
              )}
            >
              {isOpen ? (
                <PanelLeftCloseIcon className="size-5 shrink-0" />
              ) : (
                <PanelLeftOpenIcon className="size-5 shrink-0" />
              )}
              {isOpen && <span>Collapse</span>}
            </button>
          </li>
        </ul>
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
cd /c/Users/TO\ GOD\ BE\ THE\ GLORY/Documents/S.Y.\ 2025-2026/CAPSTONE/Main && npx tsc --noEmit -p apps/web/tsconfig.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/dashboard/components/sidebar.tsx
git commit -m "feat: dark navy sidebar with profile expandable section"
```

---
### Task 5: Modify HomePage and Wire Up Providers

**Files:**
- Modify: `apps/web/src/features/dashboard/pages/home.tsx`
- Modify: `apps/web/src/features/dashboard/dashboard.tsx` (wrap with MockUserProvider)

- [ ] **Step 1: Rewrite home.tsx**

```tsx
import { usePageTitle } from "@/hooks/use-page-title"
import { Topbar } from "@/features/dashboard/components/topbar"
import { GreetingCard } from "@/features/dashboard/components/greeting-card"

export default function HomePage() {
  usePageTitle("Home")

  return (
    <div className="flex min-h-svh flex-col">
      <Topbar />
      <GreetingCard />
      <div className="flex-1 p-6 md:p-10">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-none border border-border bg-muted/50"
            />
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wrap dashboard layout with MockUserProvider**

Edit `apps/web/src/features/dashboard/dashboard.tsx`:

Old:
```tsx
import { Outlet } from "react-router-dom"

import { Sidebar } from "@/features/dashboard/components/sidebar"
import { SidebarProvider, useSidebar } from "@/features/dashboard/components/sidebar-context"

function DashboardContent() {
  const { isOpen } = useSidebar()

  return (
    <div className="flex min-h-svh">
      <Sidebar />
      <main
        className="flex-1 transition-all duration-300"
        style={{ marginLeft: isOpen ? "240px" : "64px" }}
      >
        <Outlet />
      </main>
    </div>
  )
}

export default function DashboardLayout() {
  return (
    <SidebarProvider>
      <DashboardContent />
    </SidebarProvider>
  )
}
```

New:
```tsx
import { Outlet } from "react-router-dom"

import { Sidebar } from "@/features/dashboard/components/sidebar"
import { SidebarProvider, useSidebar } from "@/features/dashboard/components/sidebar-context"
import { MockUserProvider } from "@/features/dashboard/components/mock-user-context"

function DashboardContent() {
  const { isOpen } = useSidebar()

  return (
    <div className="flex min-h-svh">
      <Sidebar />
      <main
        className="flex-1 transition-all duration-300"
        style={{ marginLeft: isOpen ? "240px" : "64px" }}
      >
        <Outlet />
      </main>
    </div>
  )
}

export default function DashboardLayout() {
  return (
    <SidebarProvider>
      <MockUserProvider>
        <DashboardContent />
      </MockUserProvider>
    </SidebarProvider>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
cd /c/Users/TO\ GOD\ BE\ THE\ GLORY/Documents/S.Y.\ 2025-2026/CAPSTONE/Main && npx tsc --noEmit -p apps/web/tsconfig.json
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/dashboard/pages/home.tsx apps/web/src/features/dashboard/dashboard.tsx
git commit -m "feat: wire up Topbar, GreetingCard, and MockUserProvider in dashboard"
```

---
### Task 6: Final Verification

- [ ] **Step 1: Run dev server**

```bash
cd /c/Users/TO\ GOD\ BE\ THE\ GLORY/Documents/S.Y.\ 2025-2026/CAPSTONE/Main/apps/web && npm run dev
```

Expected: starts without errors.

- [ ] **Step 2: Manual verification checklist**

- Navigate to `/dashboard/home`
- Sidebar is dark navy with white/muted text
- Profile at top shows "JD" avatar, "Juan Dela Cruz", "Resident"
- Click profile → expands submenu with Profile + Sign Out
- Click Profile → navigates to `/dashboard/profile`
- Click Sign Out → navigates to `/`
- Topbar shows search with no border (underline on focus), Create button, Bell icon
- Hero shows glass card with correct time-of-day greeting and Filipino date
- 6 skeleton cards render below
- Sidebar toggle collapses to icon-only, profile shows initials only
- Feed, Reports, Settings pages still work via sidebar nav
