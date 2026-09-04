/**
 * Avatar initials, derived one way everywhere.
 *
 * Three call sites used to compute this independently and disagreed: the staff
 * sidebar rendered two letters ("MR") while the mobile account menu and the
 * responder profile header rendered one ("M"), so the same person appeared to
 * be two different accounts depending on the screen.
 */
export function initials(
  name: string | null | undefined,
  fallback = "U"
): string {
  const parts = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    // Drop generational suffixes so "Jose Rizal Jr." stays JR for Jose Rizal
    // rather than becoming JJ.
    .filter((part) => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(part))

  const letters = [parts[0], parts[parts.length - 1]]
    .filter(
      (part, index, all): part is string =>
        Boolean(part) && (index === 0 || part !== all[0])
    )
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")

  return letters || fallback
}
