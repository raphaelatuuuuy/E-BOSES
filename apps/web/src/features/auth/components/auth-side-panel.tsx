import { useAuthPanelRotation } from "@/features/auth/hooks/use-auth-panel-rotation"

export function AuthSidePanel() {
  const { image, taglineLines } = useAuthPanelRotation()

  return (
    <section
      className="relative hidden h-full min-h-screen overflow-hidden lg:block"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${image})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/25 to-black/10" />
      <div className="absolute bottom-0 left-0 right-0 p-8 md:p-10">
        <h2 className="font-heading text-balance text-3xl leading-tight text-white md:text-4xl">
          {taglineLines[0]}
          <br />
          {taglineLines[1]}
        </h2>
      </div>
    </section>
  )
}
