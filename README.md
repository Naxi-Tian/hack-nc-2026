# hack-nc-2026

HackNC project building a simple investment link for startups at any stage.

## Project plan

Read the [complete mega plan](docs/MEGA_PLAN.md) for founder profiles, website/LinkedIn/contact information, an initial valuation algorithm, direct share purchases, backend architecture, balanced credit ledger, atomic share issuance, testing, and the 24-hour schedule.

Backend implementers (human or AI) should follow the [backend tech stack spec](docs/BACKEND_STACK.md): fixed stack, repo layout, SQL function catalog, API/error conventions, tests, and build order.

## Proposed MVP

1. A founder creates a company profile and receives an illustrative valuation suggestion.
2. The founder approves a fixed price and finite share offering, then adds an “Invest in us” link to their website.
3. Any registered demo user buys virtual shares directly from the startup with free demo credits.
4. The backend credits the startup's simulation account and issues shares in one transaction.
5. Investors see holdings and receipts; founders see proceeds and remaining allocation.

**Purchases are from startups only. Investor resale and secondary trading are outside current scope.**

Platform-issued virtual units have no legal ownership or cash value. Actual equity is a future integration requiring a valid issuance/settlement arrangement. Virtual holdings do not automatically convert into actual shares. Valuation v1 is a transparent demo heuristic, not a validated appraisal.

## Current status

Planning documentation is available. The application, setup commands, and deployed demo are not implemented yet. Start with H01–H04 in the [execution backlog](docs/MEGA_PLAN.md#24-github-structure-and-execution-backlog).

Repository: [avidnerd/hack-nc-2026](https://github.com/avidnerd/hack-nc-2026).
