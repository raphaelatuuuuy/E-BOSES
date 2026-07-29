import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"

import "@workspace/ui/globals.css"

import { Toaster } from "@workspace/ui/components/sonner"

import App from "./App"
import { ThemeProvider } from "./components/theme-provider"
import { registerAppServiceWorker } from "./lib/pwa"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element #root was not found.")
}

void registerAppServiceWorker()

createRoot(rootElement).render(
  <BrowserRouter>
    <ThemeProvider defaultTheme="light">
      <App />
      {/* Default app toasts (top-right on desktop) */}
      <Toaster />
      {/* Centered toasts — use toast(..., { toasterId: "center" }) */}
      <Toaster id="center" position="top-center" />
    </ThemeProvider>
  </BrowserRouter>,
)
