# Evidence Research (Gemini + deterministic verification)

Scope: how a founder's links and text become scored evidence. Amends [MARKET ARCHITECTURE §6.2](MARKET%20ARCHITECTURE.md#62-gemini) and [BACKEND_STACK §10](BACKEND_STACK.md#10-gemini-m62). Approved by the project owner on 2026-10-10.

## 1. Principle

Gemini **finds and quotes** evidence. Deterministic code **decides what it is worth**. Gemini never sets an evidence status, a score, a weight, or a price; every number on a valuation page traces to a stored claim, a verbatim quote, a source, and a versioned rubric.

## 2. Decisions

| # | Decision | Effect |
|---|---|---|
| 1 | Gemini may assess four judgment sub-factors (`pain_urgency`, `differentiation`, `defensibility`, `growth_or_tailwind`) with verified citations | Stored as `AI_ASSESSED` claims, multiplier `c = 0.35`, so each bounded to `[0.325, 0.675]`; any stronger claim for the same sub-factor wins |
| 2 | Founders may drop only their own `FOUNDER_ATTESTED` statements | Third-party, collector, AI, and contradicted claims are always persisted; founders can mark them `founder_disputed` for a reviewer |
| 3 | Temperature stays at Gemini 3's default 1.0 | Google: "we strongly recommend keeping the temperature parameter at its default value of 1.0" for Gemini 3 ([docs](https://ai.google.dev/gemini-api/docs/gemini-3#temperature)); supersedes the earlier 0.2 |
| 4 | No Gemini background mode | It needs stored interactions (Google-side retention); runs execute in-process with a DB lease instead |

## 3. Pipeline

```text
POST /api/projects/:id/research-runs {website_url, urls[≤10], founder_text?, refresh?}
  → validate + canonicalize URLs → cache (24 h, same input+pipeline+model) → rate limit (3/h/project)
  → research_runs row (QUEUED; one in-flight run per project) → 202 {runId}
  background:
  1. Classify links: LinkedIn / Google Docs / YouTube → not readable, remediation warning
  2. Server fetch of founder links (SSRF-guarded)          ┐
  3. GitHub REST collector (no AI)                         ├ in parallel
  4. Gemini founder pass: url_context + structured output  │
  5. Gemini corroboration pass: google_search + url_context┘
  6. Server fetch of every page the corroboration pass cites (≤15)
  7. verifier.ts assigns evidence_status; result stored on the run (SUCCEEDED / PARTIAL / FAILED)
GET  /api/projects/:id/research-runs/:runId                      → poll; proposals with status, quote, source
POST /api/projects/:id/research-runs/:runId/confirm {accept[], dispute[]}
  → evidence_claims + evidence_verifications (append-only), once per run
```

Code: `backend/src/evidence/` (`metrics.ts`, `decimal.ts`, `research/*`), `backend/src/routes/research.ts`, `backend/src/valuation/quality-scores.ts`. Migration: `db/migrations/0002_evidence_research.sql`. Model parameters: `db/seeds/valuation-v0.1.json`.

## 4. Evidence status rules (`verifier.ts`, version `verifier-v1`)

| Origin | Condition | Status |
|---|---|---|
| GitHub API | Repo homepage or owner profile site is the project domain | `INDEPENDENTLY_VERIFIED` |
| GitHub API | Not attributed (could be anyone's repo) | `PUBLIC_WEAK` |
| Founder text | Quote is verbatim in the submitted text | `FOUNDER_ATTESTED` |
| Founder link, founder-controlled (project domain or self-publishing host such as Notion, Vercel, GitHub, Medium, LinkedIn) | Quote found, or page unverifiable (client-rendered, unreadable) | `FOUNDER_ATTESTED` |
| Founder link, third-party | Quote found and page names the company | `PUBLIC_WEAK`; otherwise `FOUNDER_ATTESTED` |
| Search-found page | Not founder-controlled, quote found in **our own fetch**, page names the company **and** its domain (market metrics `tam_usd`/`market_growth_pct` exempt) | `PUBLIC_WEAK`; otherwise dropped |
| AI assessment | ≥1 citation whose quote is found in a fetched page; no pedigree reasoning | `AI_ASSESSED` |
| Any | Value not literally in its quote, quote not in source, unknown metric, out of range | Dropped (listed in `rejected`) |
| Contradiction | Same metric/period differs by >25%: weaker claims that disagree with the strongest tier, or the whole group if the strongest tier disagrees internally | `MISSING_OR_CONTRADICTED` |

Gemini's grounding metadata (`url_context_result`, `url_citation`) is recorded (`grounding_seen`) but is not sufficient on its own; the server-side quote check is the gate. A page on the founder's own domain is never more than founder-attested, however official it looks.

Pedigree (M§2.3): the metric vocabulary in `metrics.ts` is closed and is passed to Gemini as an enum, so schools, demographics, and employer prestige have no field to occupy. A regex on assessment rationales is a backstop only.

## 5. Scoring (`quality-scores.ts`)

Implements M§4.3–4.5 and BACKEND_STACK §5.1: rubric → `s ∈ {0, .25, .5, .75, 1}`; `adjusted = c·s + (1−c)·0.5`; per sub-factor the highest-`c` claim wins, then most recent, then metric code and claim id. `evidence_quality` is derived (share of claims with `c ≥ 0.65`, `c = 1`). Missing evidence is neutral, never negative.

**Rubric thresholds in `valuation-v0.1.json` are invented demo priors** and need team sign-off before the model version leaves `DRAFT`. Stage and factor weights are M§4.3–4.4 verbatim.

## 6. Failure states

| Situation | Behavior |
|---|---|
| Gemini down / invalid JSON for one pass | Run is `PARTIAL`; the other pass and collectors still count |
| Both passes fail and no collector data | Run `FAILED` (`AI_UNAVAILABLE`); valuation still works from existing claims |
| Unreadable link (login, paywall, Google Docs, video, HTTP error) | `PARTIAL` with a per-source remediation warning |
| Process dies mid-run | Lease (5 min) expires; `recoverStaleRuns()` marks it `FAILED` (`LEASE_EXPIRED`) |
| Confirm retried | Row lock + `confirmed_at`: second call returns `ALREADY_CONFIRMED` |

## 7. Security

- SSRF: `safe-fetch.ts` allows http(s) on 80/443 only, validates every DNS answer inside the socket lookup (no rebinding window), blocks private/reserved IPv4 and IPv6 ranges, re-validates redirects (≤4), caps bodies at 2 MB after decompression, 8 s deadline.
- Prompt injection: page and founder text are delimited and labeled untrusted; output is schema-constrained; nothing Gemini says is trusted without the quote check.
- Privacy: founder text and run results are only served to project editors; page text stored is public web content (≤200 KB per page). `store: false` on every Gemini call.

## 8. Known limits (demo shortcuts)

- A third party could publish a page naming the startup and its domain with false numbers; it would count as `PUBLIC_WEAK` (0.65). Mitigations: contradiction marking, founder dispute, reviewer queue. Production follow-up: source reputation, domain age, reviewer sampling.
- `siteKey` approximates the registrable domain without the full Public Suffix List; unknown multi-part suffixes err toward "founder-controlled" (the lower level).
- PDFs and JS-rendered pages cannot be quote-checked by the server; claims from them stay founder-attested.
- Google Search is billed per executed query; the prompt asks for ≤6 and `research_runs.search_query_count` records usage, but the API offers no hard per-call cap that we found.
- Structured output with built-in tools is a Gemini 3 preview feature. Run `npm run probe:gemini` (backend) with a key before demoing; it was not run during implementation because no key was available.
- `traction_metrics`, score/valuation snapshots, reviewer verification endpoint, and the frontend review screen are not built here.
