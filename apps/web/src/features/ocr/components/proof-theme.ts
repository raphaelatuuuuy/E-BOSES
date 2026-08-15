// These screens ran their own palette: blue for primary actions, orange for
// focus rings. That made a third accent inside a product with two, so the ID
// screens never looked like the rest of Configuration.
//
// Now they borrow the shared tokens. Navy carries structure and primary
// actions, the accent carries focus and emphasis, and colour beyond that is
// reserved for genuine signal.
export const PROOF_THEME = {
  bg: "bg-white",
  card: "rounded-xl border border-neutral-200 bg-white",
  title: "text-brand-navy",
  body: "text-neutral-600",
  muted: "text-neutral-500",
  primary: "var(--color-brand-navy)",
  primaryBg: "rounded-full bg-brand-navy hover:bg-accent",
  border: "border-neutral-200",
  soft: "bg-neutral-100",
  accent: "text-accent",
} as const

export function proofSelectClass() {
  return "h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-read text-brand-navy outline-none focus:border-accent"
}