import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import { isPublicPageModule, nativeBuild, nativePublicAssets } from "./native-build.ts"

test("native assets retain shared auth, dashboard, map, and font assets only", () => {
  for (const asset of nativePublicAssets) {
    assert.ok(existsSync(new URL(`./public/${asset}`, import.meta.url)), asset)
  }
  for (const asset of ["contents/logo.webp", "contents/feature-1.webp", "contents/feed-header.webp", "contents/marikina-area-2.webp", "fonts", "tiles", "icons"]) {
    assert.ok(nativePublicAssets.includes(asset), asset)
  }
  for (const asset of ["contents", "contents/lefthand.webp", "contents/IMG_3092.webp", "contents/marikina-heights.svg", "fonts/landing", "eboses-sw.js", "manifest.webmanifest"]) {
    assert.ok(!nativePublicAssets.includes(asset), asset)
  }
})

test("native bundle guard rejects public route modules on either platform", () => {
  const plugin = nativeBuild()
  for (const id of [
    "/src/features/landing/landing-page.tsx",
    "C:\\src\\features\\landing\\pages\\report-issue-page.tsx",
    "/src/features/communities/active-communities-page.tsx",
    "/src/features/help/help-page.tsx",
    "/src/features/help/help-collection-page.tsx",
    "/src/features/help/help-article-page.tsx",
    "/src/features/help/help-shell.tsx",
  ]) {
    assert.ok(isPublicPageModule(id), id)
    assert.throws(() => plugin.generateBundle.call(
      { error(message) { throw new Error(message) } },
      {},
      { chunk: { type: "chunk", modules: { [id]: {} } } },
    ), /Public page included/)
  }
  for (const id of ["/src/features/help/native-help.tsx", "/src/features/help/help-content.ts", "/src/features/auth/sign-in.tsx", "/src/features/dashboard/pages/home.tsx", "/src/features/guest/guest-report-page.tsx"]) {
    assert.equal(isPublicPageModule(id), false, id)
  }
})

test("native transforms remove web manifest and marketing fonts without modifying shared fonts", () => {
  const plugin = nativeBuild()
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8")
  const nativeHtml = plugin.transformIndexHtml(html)
  assert.ok(!nativeHtml.includes('rel="manifest"'))
  assert.ok(nativeHtml.includes("/icons/favicon.png"))
  const css = readFileSync(new URL("../../packages/ui/src/styles/globals.css", import.meta.url), "utf8")
  const nativeCss = plugin.transform(css, "/packages/ui/src/styles/globals.css")
  assert.ok(!nativeCss.includes("/fonts/landing/"))
  assert.ok(nativeCss.includes("/fonts/saans/"))
  assert.equal(plugin.transform(css, "/other.css"), undefined)
})
