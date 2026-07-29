import { Link, useLocation } from "react-router-dom"
import { useState } from "react"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import { initials } from "@/lib/initials"
import { useAuthSession } from "@/features/auth/auth-session"
import { isOfficialUser, isResponderUser } from "@/features/auth/roles"
import { CreateReportDialog } from "@/features/dashboard/components/create-report-dialog"
import { useNotifications } from "@/features/dashboard/components/notification-context"
import { useOfficialBadges } from "@/features/dashboard/hooks/use-official-badges"
import { getRoleNav, type NavItemConfig } from "@/features/dashboard/lib/navigation"

function navLinkClass(active: boolean) {
  return cn(
    "group flex h-11 items-center gap-3 px-2.5 text-[16px] leading-none transition-[colors,font-weight] duration-150",
    "bg-transparent hover:bg-transparent focus-visible:bg-transparent active:bg-transparent",
    "hover:font-semibold focus-visible:font-semibold",
    active
      ? "font-semibold text-brand-navy"
      : "font-light text-neutral-700 hover:text-brand-navy focus-visible:text-brand-navy",
  )
}

function navIconClass(active: boolean) {
  return cn(
    "size-5 shrink-0 transition-colors",
    active
      ? "text-brand-navy"
      : "text-neutral-500 group-hover:text-brand-navy group-focus-visible:text-brand-navy",
  )
}

/** Nextdoor-style nav column — logo lives in ResidentLogoBar */
function ResidentSidebar() {
  const location = useLocation()
  const [createOpen, setCreateOpen] = useState(false)
  const nav = getRoleNav("resident")

  return (
    <>
      <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white">
        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-6 [scrollbar-width:thin]">
          <ul className="flex flex-col gap-0.5 px-3">
            {nav.items.map((item) => {
              const active = item.isActive(location.pathname)
              const Icon = item.icon
              return (
                <li key={item.key}>
                  <Link
                    to={item.to}
                    aria-current={active ? "page" : undefined}
                    className={navLinkClass(active)}
                  >
                    <Icon className={navIconClass(active)} />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>

          <div className="mt-3 px-3 pb-3">
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="flex h-11 w-full items-center justify-center rounded-[9999px] bg-primary text-[16px] font-semibold text-white transition-colors hover:bg-brand-orange-strong active:scale-[0.99]"
            >
              Submit a Concern
            </button>
          </div>
        </nav>

        <div className="shrink-0 bg-white px-3 pb-5 pt-2">
          {nav.footer.map((item) => {
            const active = item.isActive(location.pathname)
            return (
              <Link
                key={item.key}
                to={item.to}
                className={cn(
                  "flex h-10 items-center px-2.5 text-[16px] transition-[colors,font-weight]",
                  "bg-transparent hover:bg-transparent focus-visible:bg-transparent active:bg-transparent",
                  active
                    ? "font-semibold text-brand-navy"
                    : "font-medium text-neutral-600 hover:text-brand-navy focus-visible:text-brand-navy",
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
      </aside>

      <CreateReportDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}

/**
 * Staff nav row — icon, label, trailing count badge, on one line.
 *
 * Active state is a raised navy chip with a flush orange edge bar, not a
 * saturated orange fill: on a dark panel the tint reads as "you are here"
 * without turning the whole nav into a warning colour. Orange stays reserved
 * for the edge bar, the icon and the count, so it still leads the eye.
 */
function StaffNavRow({
  item,
  active,
  badge,
  onClick,
  asButton = false,
  expanded,
}: {
  item: NavItemConfig
  active: boolean
  /** Count of items awaiting the official on that screen. */
  badge?: number
  onClick?: () => void
  asButton?: boolean
  expanded?: boolean
}) {
  // Only live emergencies earn the alarm treatment. Everything else is
  // pending work, which can wait for the official to look at it.
  const urgent = item.key === "emergencies" && (badge ?? 0) > 0
  const Icon = item.icon
  const inner = (
    <>
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-orange transition-opacity duration-150",
          active ? "opacity-100" : "opacity-0",
        )}
      />

      <Icon
        className={cn(
          "size-[18px] shrink-0 transition-colors",
          active ? "text-brand-orange" : "text-nav-muted group-hover:text-nav-text-active",
        )}
        strokeWidth={active ? 2.1 : 1.7}
      />

      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left text-[13.5px] leading-none transition-colors",
          active
            ? "font-semibold text-nav-text-active"
            : "font-medium text-nav-text group-hover:text-nav-text-active",
        )}
      >
        {item.label}
      </span>

      {badge && badge > 0 ? (
        <span
          className={cn(
            "relative flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-pill px-1.5",
            "text-micro leading-none tabular-nums",
            // Urgency tiers. Previously every badge rendered identically, so
            // "3 pending configuration requests" shouted exactly as loud as
            // "2 active emergencies". Only the emergency count is allowed to
            // use the alarm colour, and it is the one badge that pulses.
            urgent
              ? "bg-severity-critical text-brand-orange-ink"
              : active
                ? "bg-brand-orange text-brand-orange-ink"
                : "bg-nav-active text-nav-text",
          )}
        >
          {urgent ? (
            <span
              aria-hidden
              className="ops-pulse absolute inset-0 rounded-pill text-severity-critical"
            />
          ) : null}
          <span className="relative">{badge > 99 ? "99+" : badge}</span>
        </span>
      ) : null}

      {expanded != null ? (
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-nav-muted transition-transform duration-200",
            expanded && "rotate-180",
          )}
          strokeWidth={2.4}
        />
      ) : null}
    </>
  )

  const className = cn(
    "group relative flex h-10 w-full items-center gap-2.5 rounded-xl pl-3 pr-2.5",
    "transition-colors duration-150",
    active ? "bg-nav-active" : "hover:bg-nav-raised",
  )

  if (asButton) {
    return (
      <button type="button" onClick={onClick} className={className} aria-expanded={expanded}>
        {inner}
      </button>
    )
  }

  return (
    <Link to={item.to} aria-current={active ? "page" : undefined} className={className}>
      {inner}
    </Link>
  )
}

/** Tiny uppercase group heading (ref 3 "MENU / FINANCIAL", ref 8 "NAVIGATION"). */
function StaffNavSection({ label }: { label: string }) {
  return (
    <p className="px-3 pb-1.5 pt-4 text-micro uppercase text-nav-muted first:pt-1">
      {label}
    </p>
  )
}

/**
 * The barangay's state, pinned under the logo and visible from every screen.
 *
 * This is fixing an operational gap, not decorating the rail. The equivalent
 * status line currently lives only on the Overview page, so the moment an
 * official navigates to Concerns or Configuration they lose all sight of
 * whether anything is on fire. In an emergency system that is backwards, and
 * the rail is the right home for it because the rail is the only thing that is
 * always on screen.
 *
 * Quiet and green is the common case and stays visually cheap; the alarm state
 * earns its weight precisely because it is rare.
 */
function StaffStatusStrip({ live }: { live: number }) {
  const alarm = live > 0

  return (
    <Link
      to="/dashboard/emergencies"
      className={cn(
        "mx-3 mb-1 flex items-center gap-2 rounded-control px-2.5 py-2 transition-colors duration-150",
        alarm ? "bg-sos/15 hover:bg-sos/25" : "hover:bg-nav-raised",
      )}
    >
      {/* The dot carries the state colour and the label stays on the rail's own
          palette. A severity *surface* here would drop a pale pink chip onto the
          navy rail — the tinted surfaces are built for white cards, not for the
          one dark panel in the shell. */}
      <span
        className={cn(
          "relative flex size-1.5 shrink-0 rounded-pill",
          alarm ? "bg-sos-bright text-sos-bright" : "bg-chart-5",
        )}
      >
        {alarm ? <span aria-hidden className="ops-pulse absolute inset-0 rounded-pill" /> : null}
      </span>
      <span
        className={cn(
          "truncate text-micro uppercase",
          alarm ? "text-nav-text-active" : "text-nav-muted",
        )}
      >
        {alarm ? `${live} active` : "All clear"}
      </span>
    </Link>
  )
}

/**
 * Heading to print above each item, or null when it continues the current
 * group. Precomputed so the render pass never carries a mutable cursor.
 */
function sectionHeadings(items: readonly NavItemConfig[]): Array<string | null> {
  let previous: string | undefined
  return items.map((item) => {
    const heading = item.section && item.section !== previous ? item.section : null
    if (item.section) previous = item.section
    return heading
  })
}

/**
 * Account block pinned to the panel footer.
 *
 * Acts as its own disclosure rather than a link: profile, notifications and
 * settings are all personal destinations, so grouping them behind the person's
 * own name keeps the nav above it purely about barangay work. It opens upward,
 * because it sits on the floor of the panel.
 */
function StaffAccountBlock({
  name,
  role,
  items,
  badge,
}: {
  name: string
  role: string
  items: readonly NavItemConfig[]
  /** Unread notifications, surfaced on the collapsed block. */
  badge?: number
}) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const avatarInitials = initials(name)

  // No account group means there is nothing to disclose. Render the identity as
  // plain text rather than a button that does nothing.
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2.5 px-2.5 py-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-nav-active text-[11.5px] font-black text-white ring-1 ring-white/10">
          {avatarInitials}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[12.5px] font-bold leading-tight text-nav-text-active">
            {name}
          </span>
          <span className="truncate text-[10.5px] font-semibold leading-tight text-nav-muted">
            {role}
          </span>
        </span>
      </div>
    )
  }

  return (
    <div>
      {open ? (
        <ul className="mb-1 flex flex-col gap-0.5">
          {items.map((item) => {
            const active = item.isActive(location.pathname)
            const Icon = item.icon
            return (
              <li key={item.key}>
                <Link
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex h-9 items-center gap-2.5 rounded-lg px-3 text-[12.5px] leading-none transition-colors",
                    active
                      ? "bg-nav-active font-bold text-nav-text-active"
                      : "font-medium text-nav-text hover:bg-nav-raised hover:text-nav-text-active",
                  )}
                >
                  <Icon
                    className={cn("size-4 shrink-0", active ? "text-brand-orange" : "text-nav-muted")}
                    strokeWidth={1.8}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.key === "notifications" && badge && badge > 0 ? (
                    <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-brand-orange px-1.5 text-[10px] font-black leading-none text-brand-orange-ink tabular-nums">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-nav-raised"
      >
        <span className="relative shrink-0">
          <span className="flex size-9 items-center justify-center rounded-full bg-nav-active text-[11.5px] font-black text-white ring-1 ring-white/10">
            {avatarInitials}
          </span>
          {!open && badge && badge > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-brand-orange ring-2 ring-nav-bg" />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[12.5px] font-bold leading-tight text-nav-text-active">
            {name}
          </span>
          <span className="truncate text-[10.5px] font-semibold leading-tight text-nav-muted">
            {role}
          </span>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-nav-muted transition-transform duration-200",
            open && "rotate-180",
          )}
          strokeWidth={2.4}
        />
      </button>
    </div>
  )
}

/**
 * Official / responder sidebar — fixed 232px navy panel with text labels.
 *
 * Items are grouped under their `section` heading; Configuration expands its
 * five children inline (indented, hairline rule on the left) rather than in a
 * flyout, so an official can see the whole IA at once instead of discovering it
 * by hover.
 */
function StaffSidebar() {
  const location = useLocation()
  const { user } = useAuthSession()
  const isResponderRole = isResponderUser(user)
  const isOfficialRole = isOfficialUser(user)
  const nav = isResponderRole
    ? getRoleNav("responder")
    : isOfficialRole
      ? getRoleNav("official")
      : null
  const navItems: NavItemConfig[] = nav?.items ?? []
  const footerItems: NavItemConfig[] = nav?.footer ?? []
  const badges = useOfficialBadges(isOfficialRole)
  // The bell moved out of the (now removed) staff top bar, so the unread count
  // rides on the account block instead.
  const { unreadCount } = useNotifications()

  // Groups with children start open when one of their children is the current
  // page, so a deep link never lands on a collapsed section.
  const [openKeys, setOpenKeys] = useState<string[]>(() =>
    navItems
      .filter((item) => item.children?.some((child) => child.isActive(location.pathname)))
      .map((item) => item.key),
  )

  function toggle(key: string) {
    setOpenKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]))
  }

  const headings = sectionHeadings(navItems)

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-nav-bg">
      {isOfficialRole ? <StaffStatusStrip live={badges.emergencies ?? 0} /> : null}

      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pb-2 [scrollbar-width:none]">
        <ul className="flex flex-col gap-0.5">
          {navItems.map((item, index) => {
            const childActive =
              item.children?.some((child) => child.isActive(location.pathname)) ?? false
            const active = item.isActive(location.pathname) || childActive
            const hasChildren = Boolean(item.children?.length)
            const open = openKeys.includes(item.key)
            const heading = headings[index]

            return (
              <li key={item.key}>
                {heading ? <StaffNavSection label={heading} /> : null}

                <StaffNavRow
                  item={item}
                  active={active}
                  badge={badges[item.key]}
                  asButton={hasChildren}
                  expanded={hasChildren ? open : undefined}
                  onClick={hasChildren ? () => toggle(item.key) : undefined}
                />

                {hasChildren && open ? (
                  <ul className="ml-[22px] mt-0.5 flex flex-col gap-0.5 border-l border-nav-border pl-2.5">
                    {item.children?.map((child) => {
                      const childIsActive = child.isActive(location.pathname)
                      return (
                        <li key={child.key}>
                          <Link
                            to={child.to}
                            aria-current={childIsActive ? "page" : undefined}
                            className={cn(
                              "flex h-8 items-center rounded-lg px-2.5 text-[12.5px] leading-none transition-colors",
                              childIsActive
                                ? "bg-nav-active font-bold text-nav-text-active"
                                : "font-medium text-nav-muted hover:bg-nav-raised hover:text-nav-text-active",
                            )}
                          >
                            <span className="min-w-0 truncate">{child.label}</span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-nav-border px-2.5 pb-3 pt-2">
        {footerItems.length ? (
          <ul className="mb-1 flex flex-col gap-0.5">
            {footerItems.map((item) => (
              <li key={item.key}>
                <StaffNavRow item={item} active={item.isActive(location.pathname)} />
              </li>
            ))}
          </ul>
        ) : null}

        <StaffAccountBlock
          name={user?.full_name || "Account"}
          role={isResponderRole ? "First responder" : "Barangay official"}
          items={nav?.account ?? []}
          badge={unreadCount}
        />
      </div>
    </aside>
  )
}

export function Sidebar() {
  const { user } = useAuthSession()
  const isResponderRole = isResponderUser(user)
  const isOfficialRole = isOfficialUser(user)

  if (!isOfficialRole && !isResponderRole) {
    return <ResidentSidebar />
  }

  return <StaffSidebar />
}

export function SidebarSosButton() {
  return null
}
