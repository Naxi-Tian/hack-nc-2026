import Link from "next/link";

const TABS = [
  { href: "/rounds/", label: "Rounds" },
  { href: "/launch/", label: "List" },
  { href: "/news/", label: "News" },
] as const;

export default function SubHeader({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <header className="page top">
      <Link className="back" href="/"><span>←</span> Front page</Link>
      <Link className="mark" href="/">The Prospecto</Link>
      <nav className="tabs">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.href === current ? "page" : undefined}>{t.label}</Link>
        ))}
      </nav>
    </header>
  );
}
