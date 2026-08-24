import { useAuthPanelRotation } from "@/features/auth/hooks/use-auth-panel-rotation"

export function AuthSidePanel() {
  const { slide, current } = useAuthPanelRotation()

  return (
    <section className="relative hidden flex-col overflow-hidden lg:flex lg:h-full lg:min-h-screen">
      {/* Image area */}
      <div className="relative flex-1 overflow-hidden">
        <div
          key={current}
          className="h-full w-full animate-fade-in bg-contain bg-bottom bg-no-repeat"
          style={{ backgroundImage: `url(${slide.image})` }}
        />
      </div>

      {/* Text area */}
      <div className="flex flex-col items-center px-8 pb-8 pt-2 text-center md:px-10 md:pb-10 md:pt-3">
        <h2
          key={`${current}-title`}
          className="font-heading animate-fade-in text-balance text-3xl font-medium leading-tight text-foreground md:text-4xl"
        >
          {slide.headline}
        </h2>
      </div>
    </section>
  )
}
