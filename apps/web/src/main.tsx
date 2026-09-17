import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { Capacitor } from "@capacitor/core"

import "@workspace/ui/globals.css"

import { Toaster } from "@workspace/ui/components/sonner"

import App from "./App"
import { registerAppServiceWorker, unregisterStaleServiceWorker } from "./lib/pwa"
import { readyOfflineMap } from "./features/dashboard/components/map/tile-layers"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element #root was not found.")
}

if (Capacitor.isNativePlatform()) {
  // Capacitor serves the complete app from the APK. A web service worker adds
  // no offline capability here and can retain stale navigation responses.
  void unregisterStaleServiceWorker()
} else {
  void registerAppServiceWorker()
  readyOfflineMap()
}

createRoot(rootElement).render(
  <BrowserRouter>
    <App />
    <Toaster />
    <Toaster variant="responder" id="responder" />
    <Toaster id="center" position="top-center" />
  </BrowserRouter>,
)
