export function NeighborhoodPeekCards({ street, houseNumber }: { street: string; houseNumber?: string }) {
  return (
    <div className="border-y border-border py-5">
      <p className="text-sm text-muted-foreground">Saved home address</p>
      <p className="mt-1 font-semibold">{[houseNumber, street].filter(Boolean).join(" ")}</p>
    </div>
  )
}
