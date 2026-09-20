import fs from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"

export const nativePublicAssets = [
  "contents/logo.webp",
  "contents/feature-1.webp",
  "contents/feature-2.webp",
  "contents/feature-3.webp",
  "contents/feature-4.webp",
  "contents/feed-header.webp",
  "contents/marikina-area-2.webp",
  "fonts",
  "icons",
  "tiles",
]

export function isPublicPageModule(id: string) {
  const normalized = id.replaceAll("\\", "/")
  return normalized.includes("/features/landing/") ||
    /\/features\/communities\/active-communities-page\./.test(normalized) ||
    /\/features\/help\/help-(page|collection-page|article-page|shell)\./.test(normalized)
}

export function nativeBuild(): Plugin {
  let root: string
  let outDir: string
  return {
    name: "native-build",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith("/packages/ui/src/styles/globals.css")) return
      return code.replace(/@font-face\s*\{[^}]*\/fonts\/landing\/[^}]*\}/g, "")
    },
    configResolved(config) {
      root = config.root
      outDir = path.resolve(root, config.build.outDir)
    },
    transformIndexHtml(html) {
      return html.replace(/\s*<link rel="manifest"[^>]*>/, "")
    },
    generateBundle(_, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue
        for (const id of Object.keys(output.modules)) {
          if (isPublicPageModule(id)) this.error(`Public page included in native build: ${id}`)
        }
      }
    },
    closeBundle() {
      for (const asset of nativePublicAssets) {
        const destination = path.join(outDir, asset)
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.cpSync(path.join(root, "public", asset), destination, {
          recursive: true,
          filter: (source) => !source.replaceAll("\\", "/").includes("/fonts/landing"),
        })
      }
    },
  }
}
