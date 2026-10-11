import type { Metadata } from "next";
import { Suspense } from "react";
import ProjectView from "@/components/ProjectView";
import SubHeader from "@/components/SubHeader";
import "@/styles/sub.css";
import "@/styles/founders.css";
import "@/styles/project.css";

export const metadata: Metadata = { title: "Company · Prospecto" };

// Static export has no per-company routes, so the project comes from ?slug= (read on the client).
export default function ProjectPage() {
  return (
    <div className="S S-project">
      <SubHeader current="/rounds/" />
      <main className="page">
        <Suspense fallback={null}><ProjectView /></Suspense>
      </main>
    </div>
  );
}
