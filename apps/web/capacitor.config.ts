import type { CapacitorConfig } from "@capacitor/cli"

const liveServerUrl = process.env.CAPACITOR_SERVER_URL?.trim()

const config: CapacitorConfig = {
  appId: "com.eboses.app",
  appName: "E-Boses",
  webDir: "dist-native",
  server: liveServerUrl
    ? {
        url: liveServerUrl,
        cleartext: process.env.CAPACITOR_ALLOW_CLEARTEXT === "true",
      }
    : {
        androidScheme: "https",
      },
}

export default config
