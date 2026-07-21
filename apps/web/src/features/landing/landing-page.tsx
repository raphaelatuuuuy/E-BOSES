import { useEffect } from "react"

import { Navbar } from "./components/navbar"
import { HeroSection } from "./components/hero-section"
import { PhotoMarquee } from "./components/photo-marquee"
import { ProblemSection } from "./components/problem-section"
import { PlatformSection } from "./components/platform-section"
import { HowItWorksSection } from "./components/how-it-works-section"
import { CommunitySection } from "./components/community-section"
import { WhyNowSection } from "./components/why-now-section"
import { ImpactSection } from "./components/impact-section"
import { PartnersSection } from "./components/partners-section"
import { AudienceSection } from "./components/audience-section"
import { FutureSection } from "./components/future-section"
import { JournalSection } from "./components/journal-section"
import { ContactSection } from "./components/contact-section"
import { Footer } from "./components/footer"
import { ScrollToTop } from "./components/scroll-to-top"

export default function LandingPage() {
  useEffect(() => {
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
        <PhotoMarquee />
        <ProblemSection />
        <PlatformSection />
        <HowItWorksSection />
        <CommunitySection />
        <WhyNowSection />
        <ImpactSection />
        <PartnersSection />
        <AudienceSection />
        <FutureSection />
        <JournalSection />
        <ContactSection />
      </main>
      <Footer />
      <ScrollToTop />
    </div>
  )
}
