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
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: "#07145f",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
}

export default config
