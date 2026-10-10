"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const COVER_MS = 420;
const norm = (p: string) => (p.endsWith("/") ? p : p + "/");

/**
 * Page-turn route transition: cover the screen, navigate client-side, then lift.
 * Captures clicks before Next's own handlers so every internal <a> gets the same motion.
 * Classes on <html>: pt-out (covering) → pt-wait (covered, new route rendering) → pt-in (lifting).
 */
export default function PageTurn() {
  const router = useRouter();
  const pathname = usePathname();
  const pending = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target || a.hasAttribute("download") || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || norm(url.pathname) === norm(location.pathname)) return;
      e.preventDefault();
      e.stopPropagation();
      if (pending.current) return; // a page turn is already covering the screen
      const href = url.pathname + url.search + url.hash;
      if (reduce.matches) { router.push(href); return; }
      pending.current = true;
      root.classList.remove("pt-in");
      root.classList.add("pt-out");
      setTimeout(() => {
        root.classList.replace("pt-out", "pt-wait");
        router.push(href);
      }, COVER_MS);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  // The new route has rendered under the cover: lift it.
  useEffect(() => {
    if (!pending.current) return;
    pending.current = false;
    const root = document.documentElement;
    root.classList.remove("pt-out", "pt-wait");
    root.classList.add("pt-in");
    if (!location.hash) window.scrollTo(0, 0);
  }, [pathname]);

  return <div className="pt" aria-hidden="true"><b>P</b><i /></div>;
}
