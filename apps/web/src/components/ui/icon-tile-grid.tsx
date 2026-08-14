import type { ComponentType, ReactNode } from "react"
import { Link } from "react-router-dom"

import { cn } from "@workspace/ui/lib/utils"

export interface IconTile {
  key: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  title: ReactNode
  description?: ReactNode
  to?: string
  onClick?: () => void
}

const TILE =
  "flex size-20 shrink-0 items-center justify-center rounded-2xl bg-brand-navy text-white transition-[transform,background-color,box-shadow] duration-200 ease-out group-hover:scale-110 group-hover:bg-accent group-hover:shadow-lg motion-reduce:transition-none motion-reduce:group-hover:scale-100"

export function IconTileGrid({
  tiles,
  className,
}: {
  tiles: IconTile[]
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-x-10 gap-y-14 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {tiles.map((tile) => {
        const Icon = tile.icon
        const body = (
          <>
            <span className={TILE}>
              <Icon className="size-9" strokeWidth={1.7} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-section text-brand-navy transition-colors group-hover:text-accent">
                {tile.title}
              </span>
              {tile.description ? (
                <span className="mt-2 block text-meta leading-relaxed text-neutral-500">
                  {tile.description}
                </span>
              ) : null}
            </span>
          </>
        )
        const inner = "group flex items-start gap-6 text-left no-underline"
        return tile.to ? (
          <Link key={tile.key} to={tile.to} className={inner}>
            {body}
          </Link>
        ) : (
          <button key={tile.key} type="button" onClick={tile.onClick} className={inner}>
            {body}
          </button>
        )
      })}
    </div>
  )
}
