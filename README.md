# hack-nc-2026

HackNC project building a simple investment link for startups at any stage.

## Project plan

Read the [complete mega plan](docs/MEGA_PLAN.md) for the product direction, founder profiles, business rationale, and hackathon planning. Its original backend sections are historical; the current implementation follows the [market architecture](docs/MARKET%20ARCHITECTURE.md), [backend stack](docs/BACKEND_STACK.md), and [complete Nessie purchase flow](docs/NESSIE_PURCHASE_FLOW.md).

The plan also covers [target users and benefits](docs/MEGA_PLAN.md#28-first-users-and-potential-customers), [competitors and potential advantages](docs/MEGA_PLAN.md#30-competitive-landscape), [demand evidence](docs/MEGA_PLAN.md#32-demand-evidence-and-its-limits), and [why community funding can complement VCs](docs/MEGA_PLAN.md#33-why-complement-vcs-and-why-small-investments-matter).

Backend implementers should follow the [backend tech stack spec](docs/BACKEND_STACK.md) and [Nessie purchase-flow design](docs/NESSIE_PURCHASE_FLOW.md): account mappings, funding saga, guarded token minting, signed subscriptions, allocation/refunds, API contracts, recovery, and numerical fixtures.

## Proposed MVP

1. A founder creates a startup profile, submits evidence, and receives an explainable valuation suggestion.
2. The founder opens a fixed-price, timed primary round and shares its participation link.
3. A verified demo participant uses **Capital One Nessie** to transfer fictional dollars and fund a mock-token wallet.
4. The participant signs a Solana Devnet subscription; tokens enter the round vault and a commitment is recorded atomically.
5. After round close, the program allocates non-transferable participation receipts, splits disclosed fees, and refunds excess tokens. Tiger updates the dashboards.

**Participation is directly in startup rounds. Secondary trading is outside scope.**

All bank balances and tokens are simulated. Participation receipts have no legal ownership, cash value, redemption, or automatic conversion to actual equity. Nessie is a mock banking API, not a real bank connection or identity check. The valuation model is illustrative.

The [purchase-flow specification](docs/NESSIE_PURCHASE_FLOW.md) includes frontend request/response contracts and [verified numerical examples](docs/fixtures/nessie-purchase-cases.json). A $100 accepted commitment at $1 per unit yields 99 units after the existing 1% fee.

## Frontend

The frontend lives in [`web/`](web/) and is a Next.js static export (`output: "export"`, `trailingSlash: true`). There is no Next.js server; the backend serves the built `web/out/` folder from the same origin as `/api/*` (see [backend stack spec](docs/BACKEND_STACK.md)).

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router), React 19, TypeScript (strict) |
| Styling | Hand-written CSS in `web/styles/`, scoped per page; no Tailwind |
| Fonts | `next/font/google`: Newsreader, JetBrains Mono, UnifrakturMaguntia |
| Motion | GSAP + ScrollTrigger on the front page, a WebGL halftone canvas, CSS page-turn transitions, an IntersectionObserver scroll reveal, and a per-character hero text reveal; all respect `prefers-reduced-motion` |
| Data | Fictional fixtures in `web/lib/fixtures.ts` until the API in the backend spec exists |

Routes: `/` (front page), `/launch/` (founder listing interview), `/rounds/` (open rounds), `/news/` (explainers and round reports).

```bash
cd web
npm install
npm run dev     # http://localhost:3000
npm run lint
npm run build   # static site in web/out/
```

`landing/` holds the earlier plain-HTML prototype that `web/` replaced. It is kept for reference and is not served.

## Current status

The frontend pages are built against demo fixtures. The backend, on-chain program, and deployed demo are not implemented yet. Follow the [Nessie implementation plan](docs/NESSIE_PURCHASE_FLOW.md#13-implementation-plan-ownership-and-rollout) and backend stack build order. Live Nessie and Devnet verification require the team's credentials and deployment.

Repository: [avidnerd/hack-nc-2026](https://github.com/avidnerd/hack-nc-2026).
