"use client";

import { useState, type ReactNode } from "react";

// Front-page deck clamped to three lines, with a toggle for the full paragraph.
// The text is always in the DOM, so it stays searchable and readable by screen readers.
export default function DeckToggle({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p id="deck" className={open ? "deck" : "deck clamp"}>{children}</p>
      <button type="button" className="deck-more" aria-expanded={open} aria-controls="deck" onClick={() => setOpen(!open)}>
        {open ? "Show less −" : "Read the full story +"}
      </button>
    </>
  );
}
