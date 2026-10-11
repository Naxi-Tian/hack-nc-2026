"use client";

import { useEffect, useState } from "react";

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

// Masthead dateline as a live clock in the visitor's local time. The page is a static export,
// so nothing renders until mount: a build-time date would be stale and mismatch on hydration.
export default function LiveDateline() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <time className="mid live" dateTime={now?.toISOString()}>
      {now ? <>{DAY.format(now)} <b>·</b> {CLOCK.format(now)}</> : " "}
    </time>
  );
}
