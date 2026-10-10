"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * One-time fade-up for [data-scroll-reveal] groups ("single" | "stagger").
 * Content is visible in server HTML; the hidden start state only applies after
 * data-reveal-ready is set here, so no-JS and reduced-motion users see everything.
 */
export default function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const targets = [...document.querySelectorAll<HTMLElement>("[data-scroll-reveal]:not([data-reveal-ready])")];
    if (!targets.length || reduce.matches || !("IntersectionObserver" in window)) return;
    const show = (el: Element) => el.setAttribute("data-reveal-visible", "true");
    targets.forEach((el) => {
      if (el.dataset.scrollReveal === "stagger") {
        [...el.children].forEach((c, i) => (c as HTMLElement).style.setProperty("--reveal-i", String(Math.min(i, 3))));
      }
      el.setAttribute("data-reveal-ready", "true");
    });
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => { if (en.isIntersecting) { show(en.target); io.unobserve(en.target); } }),
      { threshold: 0.16, rootMargin: "0px 0px -6% 0px" },
    );
    targets.forEach((el) => io.observe(el));
    const onPref = () => { if (reduce.matches) { targets.forEach(show); io.disconnect(); } };
    reduce.addEventListener("change", onPref);
    return () => { io.disconnect(); reduce.removeEventListener("change", onPref); };
  }, [pathname]);

  return null;
}
