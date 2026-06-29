# Resident Dashboard Home — Design Spec

## Context

The auth flow is complete (sign-in, sign-up, OTP, forgot-password, new-password). The dashboard skeleton exists with sidebar navigation and placeholder pages. This spec redesigns the first dashbaord page a resident sees — the **Home** tab — with a polished, resident-facing look.

## Scope

This iteration touches only the **Home** page and the **Sidebar**. Other dashboard pages (Feed, Reports, Profile, Settings) remain as-is; they get the same treatment in follow-up iterations.

## Tech Stack

- React 19 + TypeScript
- Tailwind v4 with custom CSS variables
- shadcn-style components from `@workspace/ui`
- `lucide-react` for icons
- `clsx` + `tailwind-merge` (via `@workspace/ui/lib/utils`)

---

## 1. Mock User Context (New File)

**Path:** `apps/web/src/features/dashboard/components/mock-user-context.tsx`

Hardcoded mock data so the UI renders real-looking user info:

```ts
const MOCK_USER = {
  firstName: "Juan",
  lastName: "Dela Cruz",
  role: "Resident",
}
```

Exported as `useMockUser()` hook + `MockUserProvider`. Lifted to context so any dashboard component can consume it. When real auth arrives, swap the provider — consumers stay the same.

---

## 2. Sidebar (Modified)

**Path:** `apps/web/src/features/dashboard/components/sidebar.tsx`

### Color scheme

| Token | Current | New |
|-------|---------|-----|
| `aside` background | `bg-background` | `bg-[#020c4e]` (brand navy) |
| Border | `border-border` | `border-white/10` |
| Nav text (inactive) | `text-muted-foreground` | `text-white/60` |
| Nav text (active) | `bg-[#020c4e] text-white` | `bg-white/10 text-white` |
| Nav hover | `hover:bg-muted hover:text-foreground` | `hover:bg-white/5 hover:text-white/90` |
| Footer | — | same muted styling |

### Layout change: profile replaces logo

**Top section (was logo header):**
- Avatar circle: `UserIcon` (Lucide) on a `bg-white/10` rounded-full container
- Below avatar (when expanded): "Juan Dela Cruz" in white, "Resident" in `text-blue-200/80`
- **Clickable** — toggles an expandable submenu with two items:
  - **Profile** (`UserIcon` + label) → navigates to `/dashboard/profile`
  - **Sign Out** (`LogOutIcon` + label) → navigates to `/`

Collapsed state: only the avatar icon shows.

**Nav order (top to bottom):**
1. Profile section (expandable, always first)
2. Home, Feed, Reports (middle nav)
3. —separator—
4. Settings
5. Toggle (Collapse)

**Sign Out** moves out of the bottom nav and into the profile expandable. The bottom `li` for Sign Out is removed.

---

## 3. Topbar (New Component)

**Path:** `apps/web/src/features/dashboard/components/topbar.tsx`

A horizontal bar spanning the top of the content area. Two sides:

| Left | Right |
|------|-------|
| Search icon (`SearchIcon`) + input text | `Plus` icon + "Create" button | `Bell` icon (notification) |

**Search input:**
- No border, no background — just the placeholder text
- A thin bottom accent line (`border-b border-border/50`) appears on focus
- Placeholder: "Search"

**Create button:**
- Lucide `Plus` icon + "Create" text
- Styled as a subtle button (no heavy background, hover effect only)

**Notification:**
- Lucide `Bell` icon
- Plain icon button, no badge for now

---

## 4. Greeting Card (New Component)

**Path:** `apps/web/src/features/dashboard/components/greeting-card.tsx`

### Hero area

A large header section with:
- **Background:** gradient placeholder (`from-blue-900/20 to-navy-900/40` or a solid placeholder pattern) covering the top 40% of the page
- **Overlay glass card:** centered within the hero

### Glass card spec

```css
/* Approximate Tailwind classes */
bg-white/10 backdrop-blur-md border border-white/20 rounded-xl
```

Contains:
- **Heading:** "Magandang umaga, Juan" — greeting word switches by time:
  | Time range | Greeting |
  |------------|----------|
  | 5:00 – 11:59 | "Magandang umaga" |
  | 12:00 – 12:59 | "Magandang tanghali" |
  | 13:00 – 17:59 | "Magandang hapon" |
  | 18:00 – 04:59 | "Magandang gabi" |
  - Heading uses `font-heading` (Clash Display), bold, white text
- **Subtext:** "Brgy. Marikina Heights, `Araw, Buwan DD, YYYY`"
  - Day/month names in Filipino via a lookup table (`Lunes`, `Martes`, ... `Enero`, `Pebrero`, ...)
  - Date computed from `new Date()` on render, formatted manually with the lookup tables (no locale dependency)

### Dimensions

- Hero height: ~240–280px
- Glass card: max-w-lg, centered, padding comfortably around the text

---

## 5. Home Page (Modified)

**Path:** `apps/web/src/features/dashboard/pages/home.tsx`

New structure:
1. **Topbar** (full width, horizontal, at the very top)
2. **GreetingCard** (hero section with glass overlay)
3. **Content grid** (existing skeleton cards, 6 placeholders in a responsive grid)

No padding on the page container — Topbar and GreetingCard are edge-to-edge. Skeleton cards get standard `p-6` below.

---

## 6. Component Tree (Summary)

```
DashboardLayout
  ├── SidebarProvider
  │     ├── MockUserProvider
  │     │     ├── Sidebar (uses mock user data)
  │     │     └── Main Content Area
  │     │           ├── HomePage
  │     │           │     ├── Topbar
  │     │           │     ├── GreetingCard
  │     │           │     └── Skeleton grid
  │     │           ├── FeedPage (unchanged)
  │     │           ├── ...
```

---

## 7. Edge Cases & States

| Component | Edge Case | Behavior |
|-----------|-----------|----------|
| GreetingCard | Midnight boundary (00:00–04:59) | Shows "Magandang gabi" |
| GreetingCard | Date transition | Re-computes on each mount |
| Profile expandable | Sidebar collapsed | Click opens expandable (drops down) or navigates directly |
| Search input | Long text | Truncated with ellipsis |
| Notifications | No notifications | Bell icon, no badge (future: count badge) |

---

## 8. Files

### New
| Path | Purpose |
|------|---------|
| `apps/web/src/features/dashboard/components/mock-user-context.tsx` | Mock user data provider |
| `apps/web/src/features/dashboard/components/topbar.tsx` | Search + Create + Notif bar |
| `apps/web/src/features/dashboard/components/greeting-card.tsx` | Glassmorphism hero card |

### Modified
| Path | Change |
|------|--------|
| `apps/web/src/features/dashboard/components/sidebar.tsx` | Dark navy theme, profile+expandable section |
| `apps/web/src/features/dashboard/pages/home.tsx` | Wire up Topbar + GreetingCard + skeleton grid |

## 9. Verification

1. `npx tsc --noEmit -p apps/web/tsconfig.json` passes
2. Sidebar shows dark navy background with white/muted text
3. Profile at top of sidebar shows "Juan Dela Cruz / Resident" with avatar
4. Clicking profile section expands submenu (Profile, Sign Out)
5. Topbar shows search (no border) + Create button + notification bell
6. Home page hero shows glass card with correct time-of-day greeting
7. Date displays in Filipino (e.g., "Martes, Hunyo 29, 2026")
8. Skeleton cards render below hero
9. Sidebar toggle, collapse, sign out all work
