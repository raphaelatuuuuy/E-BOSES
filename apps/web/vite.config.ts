import fs from "fs"
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import basicSsl from "@vitejs/plugin-basic-ssl"
import { defineConfig, loadEnv } from "vite"
import { nativeBuild } from "./native-build"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load monorepo root `.env` (shared with Django).
  const rootEnv = loadEnv(mode, path.resolve(__dirname, "../.."), "")
  // Capacitor-specific values live beside the Android project. Vite's shared
  // root envDir does not discover this file automatically, so explicitly make
  // its API URL available to the compiled native bundle.
  const appModeEnv = loadEnv(mode, __dirname, "")
  const httpsEnabled = !["0", "false", "off", "no"].includes(
    (process.env.VITE_DEV_HTTPS ?? rootEnv.VITE_DEV_HTTPS ?? "true").toLowerCase(),
  )
  const apiProxyTarget =
    process.env.VITE_DEV_API_PROXY_TARGET ||
    rootEnv.VITE_DEV_API_PROXY_TARGET ||
    "http://127.0.0.1:8000"
  const allowedHostsRaw =
    process.env.VITE_ALLOWED_HOSTS ||
    rootEnv.VITE_ALLOWED_HOSTS ||
    ".ngrok-free.app,.ngrok-free.dev,.ngrok.app,.ngrok.dev"
  const allowedHosts =
    allowedHostsRaw.trim().toLowerCase() === "true"
      ? true
      : allowedHostsRaw
          .split(",")
          .map((host) => host.trim())
          .filter(Boolean)
  const frontendHost = (() => {
    try {
      const raw = process.env.FRONTEND_URL || rootEnv.FRONTEND_URL || ""
      return raw ? new URL(raw).hostname : ""
    } catch {
      return ""
    }
  })()
  const sslDomains = Array.from(
    new Set(
      [
        "localhost",
        "127.0.0.1",
        frontendHost,
        ...(process.env.VITE_DEV_SSL_DOMAINS || rootEnv.VITE_DEV_SSL_DOMAINS || "")
          .split(",")
          .map((domain) => domain.trim())
          .filter(Boolean),
      ].filter(Boolean),
    ),
  )
  // Prefer mkcert trusted certs over untrusted basicSsl self-signed.
  const certDir = path.resolve(__dirname, "certs")
  const mkcertCert = path.join(certDir, "localhost+4.pem")
  const mkcertKey = path.join(certDir, "localhost+4-key.pem")
  const hasMkcert = httpsEnabled && fs.existsSync(mkcertCert) && fs.existsSync(mkcertKey)

  return {
    publicDir: mode === "capacitor" ? false : "public",
    define: {
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(
        appModeEnv.VITE_API_BASE_URL || rootEnv.VITE_API_BASE_URL || "/api",
      ),
    },
    plugins: [
      react(),
      tailwindcss(),
      ...(mode === "capacitor" ? [nativeBuild()] : []),
      ...(httpsEnabled && !hasMkcert
        ? [
            basicSsl({
              name: "e-boses-dev",
              // Cover localhost + current LAN hostnames for the warning cert.
              domains: sslDomains,
            }),
          ]
        : []),
    ],
    // Load VITE_* from monorepo root `.env` (shared with Django).
    envDir: path.resolve(__dirname, "../.."),
    optimizeDeps: {
      exclude: ["maplibre-gl"],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    // Listen on all interfaces so phones/other devices on the same LAN can connect.
    server: {
      host: true, // 0.0.0.0 + LAN
      port: 5173,
      strictPort: true,
      allowedHosts,
      // The bundled Capacitor shell is served from https://localhost while
      // ADB reverse exposes this HTTPS proxy at :5173. Auth refresh/login use
      // cookies, so the proxy must explicitly allow that credentialed origin.
      cors: {
        origin: "https://localhost",
        credentials: true,
      },
      // Force TLS when enabled — use mkcert trusted certs or fall back to basicSsl.
      // Without this, a plain-HTTP Vite process causes ERR_SSL_PROTOCOL_ERROR
      // if the browser opens https://IP:5173.
      https: httpsEnabled
        ? hasMkcert
          ? { cert: fs.readFileSync(mkcertCert), key: fs.readFileSync(mkcertKey) }
          : {}
        : undefined,
      // Same-origin proxy avoids mixed-content blocks when the UI is HTTPS
      // and Django is still plain HTTP on :8000.
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
          xfwd: true,
          secure: false,
        },
        "/media": {
          target: apiProxyTarget,
          changeOrigin: true,
          xfwd: true,
          secure: false,
        },
        "/ws": {
          target: apiProxyTarget,
          changeOrigin: true,
          xfwd: true,
          secure: false,
          ws: true,
        },
      },
    },
    preview: {
      host: true,
      port: 4173,
      allowedHosts,
      cors: {
        origin: "https://localhost",
        credentials: true,
      },
      https: httpsEnabled
        ? hasMkcert
          ? { cert: fs.readFileSync(mkcertCert), key: fs.readFileSync(mkcertKey) }
          : {}
        : undefined,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
          xfwd: true,
          secure: false,
        },
        "/media": {
          target: apiProxyTarget,
          changeOrigin: true,
          xfwd: true,
          secure: false,
        },
        "/ws": {
          target: apiProxyTarget,
          changeOrigin: true,
          xfwd: true,
          secure: false,
          ws: true,
        },
      },
    },
    build: {
      outDir: mode === "capacitor" ? "dist-native" : "dist",
      rollupOptions: {
        output: {
          // Function form, not the object form: rolldown (the bundler behind
          // Vite 8 here) only accepts a function, and the object form fails the
          // build with "manualChunks is not a function".
          manualChunks(id: string) {
            if (!id.includes("node_modules") && !id.includes("packages/ui")) return
            if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/.test(id)) {
              return "react-vendor"
            }
            if (/[\\/]node_modules[\\/](three|three-stdlib|@react-three)[\\/]/.test(id)) {
              return "three-vendor"
            }
            if (/[\\/]node_modules[\\/]leaflet[\\/]/.test(id)) return "leaflet"
            if (id.includes("packages/ui")) return "ui-vendor"
            return
          },
        },
      },
      chunkSizeWarningLimit: 300,
    },
  }
})


