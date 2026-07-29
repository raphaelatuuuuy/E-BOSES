/// <reference types="vite/client" />

import type { JSX as ReactJSX } from "react"

declare module "react/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {
      ringGeometry: Record<string, unknown>
      planeGeometry: Record<string, unknown>
      sphereGeometry: Record<string, unknown>
      cylinderGeometry: Record<string, unknown>
      spriteMaterial: Record<string, unknown>
    }
  }
}
