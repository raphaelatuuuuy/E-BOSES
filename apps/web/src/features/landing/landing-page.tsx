// apps/web/src/features/landing/landing-page.tsx
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"

import { Footer } from "./components/footer"
import { GrainOverlay } from "./components/grain-overlay"
import { Navbar } from "./components/navbar"
import { ScrollToTop } from "./components/scroll-to-top"
import { AlarmMap } from "./scenes/alarm-map"
import { Bayanihan } from "./scenes/bayanihan"
import { HeroReach } from "./scenes/hero-reach"
import { Join } from "./scenes/join"
import { Problem } from "./scenes/problem"
import { VoiceJourney } from "./scenes/voice-journey"

gsap.registerPlugin(ScrollTrigger, useGSAP)

export default function LandingPage() {
  return (
    <div className="landing-fonts flex min-h-screen flex-col bg-[#07070b] text-[#f5f2ec]">
      <Navbar />
      <main className="flex-grow">
        <HeroReach />
        <Problem />
        <VoiceJourney />
        <AlarmMap />
        <Bayanihan />
        <Join />
      </main>
      <Footer />
      <ScrollToTop />
      <GrainOverlay />
    </div>
  )
}
