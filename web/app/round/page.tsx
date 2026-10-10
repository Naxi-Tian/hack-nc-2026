import type { Metadata } from "next";
import { Suspense } from "react";
import RoundView from "@/components/RoundView";
import SubHeader from "@/components/SubHeader";
import "@/styles/sub.css";
import "@/styles/landing.css";
import "@/styles/founders.css";

export const metadata: Metadata = { title: "Round · Prospecto" };

// Static export has no per-company routes, so the company comes from ?co=TICKER (read on the client).
export default function RoundPage() {
  return (
    <div className="S S-round">
      <SubHeader current="/rounds/" />
      <main className="page">
        <Suspense fallback={null}><RoundView /></Suspense>
      </main>
    </div>
  );
}
