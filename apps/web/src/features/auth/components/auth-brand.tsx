interface AuthBrandProps {
  className?: string
}

export function AuthBrand({ className }: AuthBrandProps) {
  return (
    <div className={className}>
      <img
        src="/images/logo-name.png"
        alt="E-Boses"
        className="h-10 w-auto object-contain md:h-12"
      />
    </div>
  )
}
