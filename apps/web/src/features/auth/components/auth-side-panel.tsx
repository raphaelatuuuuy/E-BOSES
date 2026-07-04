import { useAuthPanelRotation } from "@/features/auth/hooks/use-auth-panel-rotation"

export function AuthSidePanel() {
  const { image, taglineLines } = useAuthPanelRotation()

  return (
    <section
      className="relative hidden h-full min-h-screen overflow-hidden lg:block"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat animate-[kenBurns_20s_ease-in-out_infinite_alternate]"
        style={{ backgroundImage: `url(${image})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/25 to-black/10 animate-gradient-shift" />
      <div className="absolute bottom-0 left-0 right-0 p-8 md:p-10">
        <h2 className="font-heading text-balance text-3xl leading-tight text-white md:text-4xl">
          <span className="inline-block animate-fade-slide-up">{taglineLines[0]}</span>
          <br />
          <span className="inline-block animate-fade-slide-up" style={{ animationDelay: "0.15s" }}>
            {taglineLines[1]}
          </span>
        </h2>
      </div>
    </section>
  )
}
