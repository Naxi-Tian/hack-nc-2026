// Fictional demo fixtures. Replace with the Hono API (docs/BACKEND_STACK.md §7) once it exists.

export type Stage = "IDEA" | "PROTOTYPE" | "LAUNCHED" | "REVENUE" | "GROWTH";

export type Round = {
  t: string; n: string; s: Stage; e: "Unincorporated" | "Incorporated"; city: string;
  /** Display price only (fixture). Real amounts arrive as decimal strings from the API. */
  p: number; sub: number; d: number; h: string; dek: string;
};

export const ROUNDS: Round[] = [
  { t: "MOTH", n: "Mothlight", s: "IDEA", e: "Unincorporated", city: "Chapel Hill", p: 0.1, sub: 38, d: 9, h: "Mothlight wants to find you a quiet room at 2 a.m.", dek: "Two sophomores, a napkin sketch and a waitlist of 40. No code yet." },
  { t: "FERN", n: "Fernhill Robotics", s: "REVENUE", e: "Incorporated", city: "Raleigh", p: 2.36, sub: 61, d: 12, h: "The $900 robot weeding 31 small farms", dek: "Started as an NC State senior design project." },
  { t: "QUIL", n: "Quillnote", s: "LAUNCHED", e: "Incorporated", city: "Durham", p: 1.13, sub: 91, d: 2, h: "Quillnote’s notes app reaches four campuses", dek: "1,200 weekly users. Closing Friday." },
  { t: "TIDE", n: "Tidewater Sensors", s: "PROTOTYPE", e: "Unincorporated", city: "Pittsboro", p: 0.56, sub: 54, d: 15, h: "Soil sensors, tested on three farms", dek: "A working prototype and an honest label." },
  { t: "DORM", n: "Dormfold", s: "IDEA", e: "Unincorporated", city: "Chapel Hill", p: 0.09, sub: 12, d: 20, h: "Your laundry, folded by Tuesday", dek: "Just opened. Looking for its first 50 backers." },
  { t: "BRKT", n: "Bracket Bio", s: "PROTOTYPE", e: "Incorporated", city: "Durham", p: 0.47, sub: 27, d: 18, h: "A $40 test strip for lab benches", dek: "Two grad students, one bench prototype." },
  { t: "ORCH", n: "Orchard OS", s: "LAUNCHED", e: "Incorporated", city: "Greensboro", p: 0.97, sub: 66, d: 7, h: "Scheduling software for small orchards", dek: "Live with nine growers this season." },
  { t: "KILN", n: "Kiln Labs", s: "GROWTH", e: "Incorporated", city: "Charlotte", p: 5.25, sub: 100, d: 0, h: "Kiln Labs’ round is full", dek: "Follow for the next one." },
];

export type Post = { sec: "Explainer" | "Round report" | "Guide" | "Dispatch"; h: string; dek: string; date: string; min: number; body: string; co: [label: string, href: string] };

export const POSTS: Post[] = [
  { sec: "Explainer", h: "What you actually own when you back an idea", dek: "Participation receipts, mock USDC, and what they don’t give you.", date: "Oct 10, 2026", min: 6, body: "Buying 1,000 units of Mothlight debits $100 of demo credits, credits Mothlight’s round and issues 1,000 receipt units, all in one transaction. A receipt records that you backed them early. It carries no ownership, cash value or dividends.", co: ["Mothlight", "/rounds/"] },
  { sec: "Round report", h: "Fernhill Robotics passes 60% with 12 days to go", dek: "214 backers, $144,904 in demo credits, and the price hasn’t moved a cent.", date: "Oct 9, 2026", min: 3, body: "The weeding-robot company opened at a fixed $2.36 per unit. 61,400 of 100,000 units are issued. The price stays fixed until the round closes.", co: ["Fernhill", "/#rounds"] },
  { sec: "Guide", h: "How to price a company that’s still a napkin sketch", dek: "Walking through valuation-model-v1, one rubric score at a time.", date: "Oct 7, 2026", min: 9, body: "An idea-stage anchor starts at $100,000. Product, traction, team and financial readiness move it between 0.5× and 1.5×. Unknown answers count as zero, not as failure.", co: ["the Estimate Desk", "/#desk"] },
  { sec: "Dispatch", h: "“We interviewed 40 students. Here’s what they said.”", dek: "Mothlight’s first founder update since opening its round.", date: "Oct 6, 2026", min: 4, body: "Thirty-one of forty said they’d leave the library before 2 a.m. if they could find an empty room. Next: a waitlist test at two dorms.", co: ["Mothlight", "/rounds/"] },
  { sec: "Round report", h: "Kiln Labs’ round fills in nine days", dek: "The first Growth-stage round on Prospecto is fully issued.", date: "Oct 6, 2026", min: 2, body: "All 100,000 units were issued at $5.25. Existing holdings stay exactly as they are; the round simply stops accepting purchases.", co: ["open rounds", "/rounds/"] },
  { sec: "Explainer", h: "Why a fixed price is a feature, not a bug", dek: "No order book, no resale: what primary issuance means for backers.", date: "Oct 4, 2026", min: 5, body: "Every unit comes straight from the startup at the price the founder published. Nobody can bid it up or sell it to you second-hand.", co: ["open rounds", "/rounds/"] },
];
