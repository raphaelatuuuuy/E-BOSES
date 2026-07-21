import { useEffect } from "react"

import { CommunitySection } from "./components/community-section"
import { ContactSection } from "./components/contact-section"
import { Footer } from "./components/footer"
import { HeroSection } from "./components/hero-section"
import { ImpactSection } from "./components/impact-section"
import { Navbar } from "./components/navbar"
import { PlatformSection } from "./components/platform-section"
import { ProblemSection } from "./components/problem-section"
import { ScrollToTop } from "./components/scroll-to-top"

export default function LandingPage() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    document.documentElement.style.scrollBehavior = "smooth"
    return () => {
      document.documentElement.style.scrollBehavior = ""
    }
  }, [])

  return (
    <div className="landing-fonts flex min-h-screen flex-col bg-white">
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
    </div>
  )
}
