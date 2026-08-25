import { useAuthPanelRotation } from "@/features/auth/hooks/use-auth-panel-rotation"

export function AuthSidePanel() {
  const { slide, current } = useAuthPanelRotation()

  return (
    <section className="relative hidden flex-col overflow-hidden lg:flex lg:h-full lg:min-h-screen">
      {/* Image area */}
      <div className="relative flex-1 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url(/contents/orange.png)" }}
        />
        <div
          key={current}
          className="absolute inset-x-0 bottom-0 top-0 animate-slide-fade-in bg-[length:500px] bg-bottom bg-no-repeat md:bottom-40 md:right-36"
          style={{ backgroundImage: `url(${slide.image})` }}
        />
      </div>

      {/* Text area. Negative margin overlaps the image area by a hair so no
          seam/gap can appear between them regardless of rounding. */}
      <div className="-mt-15 flex flex-col items-center px-8 pb-4 pt-0 text-center md:px-10 md:pb-6 md:pt-0">
        <h2
          key={`${current}-title`}
          className="-mt-15 mr-40 font-heading animate-fade-in text-balance text-3xl font-medium leading-none text-foreground md:text-3xl"
        >
          {slide.headline}
        </h2>
      </div>
    </section>
  )
}
