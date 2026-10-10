# hack-nc-2026

HackNC project building a simple investment link for startups at any stage.

## Project plan

Read the [complete mega plan](docs/MEGA_PLAN.md) for founder profiles, website/LinkedIn/contact information, an initial valuation algorithm, direct share purchases, backend architecture, balanced credit ledger, atomic share issuance, testing, and the 24-hour schedule.

The plan also covers [target users and benefits](docs/MEGA_PLAN.md#28-first-users-and-potential-customers), [competitors and potential advantages](docs/MEGA_PLAN.md#30-competitive-landscape), [demand evidence](docs/MEGA_PLAN.md#32-demand-evidence-and-its-limits), and [why community funding can complement VCs](docs/MEGA_PLAN.md#33-why-complement-vcs-and-why-small-investments-matter).

Backend implementers (human or AI) should follow the [backend tech stack spec](docs/BACKEND_STACK.md): fixed stack, repo layout, SQL function catalog, API/error conventions, tests, and build order.

## Proposed MVP

1. A founder creates a company profile and receives an illustrative valuation suggestion.
2. The founder approves a fixed price and finite share offering, then adds an “Invest in us” link to their website.
3. Any registered demo user buys virtual shares directly from the startup with free demo credits.
4. The backend credits the startup's simulation account and issues shares in one transaction.
5. Investors see holdings and receipts; founders see proceeds and remaining allocation.

**Purchases are from startups only. Investor resale and secondary trading are outside current scope.**

Platform-issued virtual units have no legal ownership or cash value. Actual equity is a future integration requiring a valid issuance/settlement arrangement. Virtual holdings do not automatically convert into actual shares. Valuation v1 is a transparent demo heuristic, not a validated appraisal.

## Frontend

The frontend lives in [`web/`](web/) and is a Next.js static export (`output: "export"`, `trailingSlash: true`); `next build` writes a static site to `web/out/`.

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router), React 19, TypeScript (strict) |
| Styling | Hand-written CSS in `web/styles/`, scoped per page; no Tailwind |
| Fonts | `next/font/google`: Newsreader, JetBrains Mono, UnifrakturMaguntia |
| Motion | GSAP + ScrollTrigger on the front page, a WebGL halftone canvas, CSS page-turn transitions, an IntersectionObserver scroll reveal, and a per-character hero text reveal; all respect `prefers-reduced-motion` |
| Data | Fictional fixtures in `web/lib/fixtures.ts`; no API calls yet |

Routes: `/` (front page), `/launch/` (founder listing interview), `/rounds/` (open rounds), `/news/` (explainers and round reports).

```bash
cd web
npm install
npm run dev     # http://localhost:3000
npm run lint
npm run build   # static site in web/out/
```

`landing/` holds the earlier plain-HTML prototype that `web/` replaced. It is kept for reference and is not served.

> **Open integration question:** the [backend stack spec](docs/BACKEND_STACK.md) describes a single Next.js app with API route handlers under `app/api/`, but a static export cannot host route handlers or server actions. Some comments in `web/` also refer to a separate Hono server. Decide whether `web/` drops `output: "export"` and becomes that single app, or whether the backend spec changes to a separate server, before wiring the UI to the API.

## Current status

The frontend pages are built against demo fixtures. The backend, on-chain program, and deployed demo are not implemented yet. Start with H01–H04 in the [execution backlog](docs/MEGA_PLAN.md#24-github-structure-and-execution-backlog).

Repository: [avidnerd/hack-nc-2026](https://github.com/avidnerd/hack-nc-2026).
