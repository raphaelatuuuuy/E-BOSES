// Accent rule for this page (documented so the split stays intentional):
//   BLUE  = primary actions, selected states, information emphasis.
//   ORANGE = focus rings on inputs/selects (matches the shared Input default).
// Never introduce a third accent; orange never paints a button, blue never paints a focus ring.
export const PROOF_THEME = {
  bg: "bg-canvas",
  card: "rounded-2xl border border-line-tint bg-white shadow-sm",
  title: "text-brand-navy",
  body: "text-navy-muted",
  muted: "text-subtle-foreground",
  primary: "#145be7",
  primaryBg: "bg-brand-blue hover:bg-brand-blue/90",
  border: "border-line-tint",
  soft: "bg-tint",
  accent: "text-brand-blue",
} as const

export function proofSelectClass() {
  return "h-10 w-full rounded-lg border border-line-tint bg-white px-3 text-sm font-semibold text-brand-navy outline-none focus:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20"
}