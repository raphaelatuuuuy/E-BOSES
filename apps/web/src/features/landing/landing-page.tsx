// apps/web/src/features/landing/landing-page.tsx
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useGSAP } from "@gsap/react"

import { CommunitySection } from "./components/community-section"
import { ContactSection } from "./components/contact-section"
import { Footer } from "./components/footer"
import { GrainOverlay } from "./components/grain-overlay"
import { HeroSection } from "./components/hero-section"
import { ImpactSection } from "./components/impact-section"
import { Navbar } from "./components/navbar"
import { PlatformSection } from "./components/platform-section"
import { ProblemSection } from "./components/problem-section"
import { ScrollToTop } from "./components/scroll-to-top"

gsap.registerPlugin(ScrollTrigger, useGSAP)

export default function LandingPage() {
  return (
    <div className="landing-fonts flex min-h-screen flex-col bg-[#07070b] text-[#f5f2ec]">
      <Navbar />
      <main className="flex-grow">
        <HeroSection />
        <ProblemSection />
        <PlatformSection />
        <CommunitySection />
        <ImpactSection />
        <ContactSection />
      </main>
      <Footer />
      <ScrollToTop />
      <GrainOverlay />
    </div>
  )
}
