export const PROOF_THEME = {
  bg: "bg-[#f7f8fc]",
  card: "rounded-2xl border border-[#dfe7f5] bg-white shadow-sm",
  title: "text-[#07145f]",
  body: "text-[#43507f]",
  muted: "text-[#68739c]",
  primary: "#145be7",
  primaryBg: "bg-[#145be7] hover:bg-[#104bc0]",
  border: "border-[#dfe7f5]",
  soft: "bg-[#f2f6ff]",
} as const

export function proofSelectClass() {
  return "h-10 w-full rounded-lg border border-[#cbd8ee] bg-white px-3 text-sm font-semibold text-[#07145f] outline-none focus:border-[#145be7] focus-visible:ring-[3px] focus-visible:ring-[#145be7]/20"
}
