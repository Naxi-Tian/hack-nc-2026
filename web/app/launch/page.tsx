import type { Metadata } from "next";
import HeroText from "@/components/HeroText";
import LaunchInterview from "@/components/LaunchInterview";
import SubHeader from "@/components/SubHeader";
import Link from "next/link";
import "@/styles/sub.css";
import "@/styles/launch.css";

export const metadata: Metadata = { title: "List Your Company · Prospecto" };

export default function LaunchPage() {
  return (
    <div className="S S-launch">
      <SubHeader current="/launch/" />
      <main className="page">
        <div className="head">
          <HeroText text="List your" em="company." />
          <span className="kicker">Seven questions · about 3 minutes</span>
        </div>
        <LaunchInterview />
        <div className="foot"><Link href="/">← Front page</Link><Link href="/rounds/">Browse rounds →</Link></div>
      </main>
    </div>
  );
}
