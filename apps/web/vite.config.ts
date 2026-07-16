import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import basicSsl from "@vitejs/plugin-basic-ssl"
import { defineConfig, loadEnv } from "vite"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load monorepo root `.env` (shared with Django).
  const rootEnv = loadEnv(mode, path.resolve(__dirname, "../.."), "")
  const httpsEnabled = !["0", "false", "off", "no"].includes(
    (rootEnv.VITE_DEV_HTTPS ?? process.env.VITE_DEV_HTTPS ?? "true").toLowerCase(),
  )
  const apiProxyTarget =
    rootEnv.VITE_DEV_API_PROXY_TARGET ||
    process.env.VITE_DEV_API_PROXY_TARGET ||
    "http://127.0.0.1:8000"

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Temporary self-signed cert so LAN phones get a Secure Context
      // (required for geolocation, camera, etc. outside localhost).
      // Plugin fills cert/key into server.https when it is undefined or truthy.
      ...(httpsEnabled
        ? [
            basicSsl({
              name: "e-boses-dev",
              // Cover localhost + typical LAN hostnames for the warning cert.
              domains: ["localhost", "127.0.0.1", "10.31.15.164"],
            }),
          ]
        : []),
    ],
    // Load VITE_* from monorepo root `.env` (shared with Django).
    envDir: path.resolve(__dirname, "../.."),
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
      // Force TLS when enabled — empty object lets basicSsl inject cert/key.
      // Without this, a plain-HTTP Vite process causes ERR_SSL_PROTOCOL_ERROR
      // if the browser opens https://IP:5173.
      https: httpsEnabled ? {} : false,
      // Same-origin proxy avoids mixed-content blocks when the UI is HTTPS
      // and Django is still plain HTTP on :8000.
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
        "/media": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
        "/ws": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
    },
    preview: {
      host: true,
      port: 4173,
      https: httpsEnabled ? {} : false,
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
        "/media": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
        "/ws": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
    },
  }
})
