import type { CSSProperties } from "react";

type Props = { as?: "h1" | "h2"; id?: string; text: string; em?: string };

/**
 * Page-entry headline: graphemes fade in one after another (CSS only, no client JS).
 * Split deterministically on the server; screen readers get one uninterrupted heading.
 */
export default function HeroText({ as: Tag = "h1", id, text, em }: Props) {
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
  let i = 0;
  const words = (s: string) =>
    s.split(/(\s+)/).filter(Boolean).map((w, wi) =>
      /^\s+$/.test(w) ? " " : (
        <span className="hero-word" key={wi}>
          {[...seg.segment(w)].map(({ segment }) => (
            <span data-hero-unit="" key={i} style={{ "--hero-index": i++ } as CSSProperties}>{segment}</span>
          ))}
        </span>
      ),
    );
  return (
    <Tag id={id}>
      <span className="hero-sr">{em ? `${text} ${em}` : text}</span>
      <span aria-hidden="true">
        {words(text)}
        {em && <>{" "}<i>{words(em)}</i></>}
      </span>
    </Tag>
  );
}
