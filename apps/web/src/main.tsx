import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"

import "@workspace/ui/globals.css"

import { Toaster } from "@workspace/ui/components/sonner"

import App from "./App"
import { ThemeProvider } from "./components/theme-provider"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element #root was not found.")
}

createRoot(rootElement).render(
  <BrowserRouter>
    <ThemeProvider defaultTheme="light">
      <App />
      <Toaster />
    </ThemeProvider>
  </BrowserRouter>,
)
