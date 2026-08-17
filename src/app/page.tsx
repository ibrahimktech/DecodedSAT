import { FreeNote } from "@/components/FreeNote";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Mission } from "@/components/Mission";
import { Problem } from "@/components/Problem";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { VideoLibrary } from "@/components/VideoLibrary";

/**
 * The landing page is entirely static marketing copy, so it is prerendered at
 * build time and served from the edge cache — no per-request work.
 */
export const dynamic = "force-static";

export default function Home() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main>
        <Hero />
        <Problem />
        <HowItWorks />
        <VideoLibrary />
        <Mission />
        <FreeNote />
      </main>
      <SiteFooter />
    </div>
  );
}
