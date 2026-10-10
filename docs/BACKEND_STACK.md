# Backend Tech Stack & Implementation Spec

Audience: AI coding agents and backend teammates.  
Scope: **backend tech stack, structure, and implementation rules only.** Business rules (valuation formula, offering lifecycle, invariants, fixtures) live in [MEGA_PLAN.md](MEGA_PLAN.md); section references below (`§N`) point there. Where this file and MEGA_PLAN §13/§20 disagree on *technology* (MEGA_PLAN mentions Supabase), **this file wins**.  
Time budget: 24-hour hackathon. Prefer the simplest option that preserves settlement correctness.

Keywords **MUST**, **MUST NOT**, **SHOULD** are normative.

---

## 1. Stack (fixed — do not substitute)

| Concern | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript, `strict: true` | No `any` in `lib/` |
| Runtime | Node.js 22 LTS or newer | All route handlers use the Node runtime, not Edge |
| Web + API | Next.js (App Router), route handlers in `app/api/**/route.ts` | Single app for UI + API |
| Database | **Tiger Data** (Tiger Cloud managed PostgreSQL) | Single source of truth for money, shares, orders. Plain Postgres features only; no hypertables needed |
| DB driver | `pg` (node-postgres), one shared `Pool` | **No ORM.** Same driver is used by Better Auth |
| Auth | **Better Auth** (email + password), tables stored in the same Postgres | Session cookie; server reads session via `auth.api.getSession` |
| Atomic mutations | PL/pgSQL functions called as `select public.fn(...)` | See §5 |
| Validation | `zod` | Every request body, query, header, and AI output |
| Migrations | **dbmate** (`db/migrations/*.sql`, plain SQL with `-- migrate:up` / `-- migrate:down`) | Run as the owner role (§4.1) |
| Local DB | Docker `postgres:17` via `docker-compose.yml` | Hosted DB is Tiger Data |
| AI | **Gemini API** via `@google/genai`, server-only | Optional P2 features only (§8). Never in the settlement path |
| Tests | `vitest` (unit + integration against local Postgres) | §10 |
| Hosting | Vercel (app) + Tiger Data (DB) | |
| Package manager | `pnpm` | Pin exact versions in `package.json` |

### Explicitly banned for the MVP

Prisma, Drizzle, TypeORM, Kysely-as-ORM, any second migration system; Supabase SDKs; a separate Express/FastAPI/Nest server; microservices; Redis; message queues (BullMQ, Kafka, SQS); GraphQL; Edge runtime; client-side DB access; any external HTTP call (including Gemini) inside a settlement transaction; letting AI output set prices, valuations, balances, or verification status.

---

## 2. Repository layout

```text
app/
  api/
    auth/[...all]/route.ts                     Better Auth handler (toNextJsHandler)
    companies/route.ts                         GET list
    companies/[slug]/route.ts                  GET detail
    founder/companies/route.ts                 POST create
    founder/companies/[id]/route.ts            PATCH
    founder/companies/[id]/valuations/route.ts POST (deterministic v1)
    founder/companies/[id]/valuations/[vid]/explain/route.ts  POST (Gemini, P2)
    founder/companies/[id]/prefill/route.ts    POST (Gemini, P2)
    founder/offerings/route.ts                 POST draft
    founder/offerings/[id]/publish/route.ts    POST
    founder/offerings/[id]/close/route.ts      POST
    founder/dashboard/route.ts                 GET
    credits/grant/route.ts                     POST (idempotent, one per generation)
    quotes/route.ts                            POST
    purchases/route.ts                         POST (Idempotency-Key header)
    purchases/by-key/route.ts                  GET
    orders/[id]/route.ts                       GET
    portfolio/route.ts                         GET
    demo/reset/route.ts                        POST (controller only)
    demo/reconcile/route.ts                    POST (controller only)
lib/
  auth/
    auth.ts            betterAuth({ database: pool, emailAndPassword }) server instance
    session.ts         requireUser(): { id, email } or throw UNAUTHENTICATED
    client.ts          createAuthClient() for the frontend
  db/
    pool.ts            singleton pg Pool (app role); import "server-only"
    sql.ts             query<T>(), callFn<T>(name, args), withTx() helpers
    owner.ts           owner-role pool; ONLY for seed/reset scripts and tests
  http/
    handler.ts         withHandler(): request ID, auth, zod parse, error mapping, retry
    errors.ts          ERROR_CODES, AppError, HTTP status map, pg error mapper
    idempotency.ts     header parsing + request hashing (sha256 of canonical JSON)
  domain/
    money.ts           cents helpers, bounds, safe int8 conversion
    pricing.ts         price/supply/dilution math (§11); pure
    schemas.ts         zod schemas shared with frontend
  valuation/
    v1.ts              scoreValuation(input); pure, deterministic (§10)
    rubric.ts          versioned constants: anchors, weights, bands
  ai/
    gemini.ts          single Gemini wrapper: timeout, zod-validated JSON, fallback
    prompts.ts         versioned prompt templates
db/
  migrations/
    0001_auth_tables.sql          Better Auth schema (user, session, account, verification)
    0002_roles_and_core_schema.sql
    0003_ledger.sql
    0004_fn_journal.sql
    0005_fn_grant_quote_purchase.sql
    0006_fn_offering_lifecycle.sql
    0007_fn_demo_reset_reconcile.sql
    0008_ai_cache.sql             (P2)
  seed.sql             fictional fixtures (§23)
scripts/
  seed.ts              runs db/seed.sql with the owner pool
tests/
  domain/              vitest, pure functions
  integration/         vitest against local Postgres
docker-compose.yml     postgres:17 on localhost:5432
.env.example
```

---

## 3. Layer responsibilities

| Layer | MUST do | MUST NOT do |
| --- | --- | --- |
| Route handler (`app/api`) | Validate with zod, `requireUser()`, authorize ownership, call **one** SQL function or run reads, map errors | Compute persisted prices/balances; run multiple dependent writes outside a function |
| `lib/domain`, `lib/valuation` | Pure functions, no I/O, fully unit-tested | Import `pg`, Next.js, or Gemini |
| `lib/ai` | Call Gemini with timeout, validate output with zod, return a fallback on any failure | Write to money/share tables; be awaited inside a DB transaction |
| SQL functions | All writes to ledger, holdings, share events, orders, quotes, offering status, grants | Trust any price/total/balance from the client |

Rule of thumb: **if a request changes credits, shares, quotes, or offering status, it is exactly one SQL function call.** Profile/valuation-input edits may be ordinary parameterized `insert`/`update` statements scoped by `owner_id = $actor`.

All SQL MUST be parameterized (`$1, $2…`). No string-interpolated SQL.

---

## 4. Database conventions

- Better Auth user IDs are `text`; every `owner_id`, `investor_id`, `actor_id` column is `text references "user"(id)`.
- Other primary keys: `uuid default gen_random_uuid()`.
- Timestamps: `timestamptz default now()`; all deadline comparisons use database `now()`, never client time.
- Money: `bigint` cents. Quantities: `bigint`, `CHECK (quantity > 0)`.
- JS-safe range: app-level bounds keep every value below 2^53 (quantity ≤ 10,000,000; unit price ≤ 100,000,000 cents); add matching `CHECK` constraints. `pg` returns `int8` as strings — convert only via `toSafeInt()` in `lib/domain/money.ts`, which throws if `!Number.isSafeInteger`.
- Enums: Postgres `enum` types for `stage`, `entity_status`, `offering_status`, `instrument_type`, `order_status`, `evidence_status`.
- Every mutable money/share table carries `scenario_id` + `generation` (§23 isolation).
- Required unique constraints (§14): `(actor_id, operation, idempotency_key)`; `orders(quote_id)`; one primary journal per order; one issuance `share_event` per order; `holdings(owner_id, instrument_id)`; one grant per `(account, scenario_id, generation)`; partial unique index `offerings(company_id) WHERE status = 'PUBLISHED'`; `follows(user_id, company_id)`.
- Naming: tables `snake_case` plural; functions `snake_case` verbs; parameters `p_`, locals `v_`.

### 4.1 Roles (replaces RLS)

There is no Supabase RLS layer. Access control is: **authorization in the route handler + database privileges that make direct ledger writes impossible for the app.**

```sql
-- 0002: run as the Tiger Data admin (tsdbadmin) / owner connection
create role app_owner nologin;           -- owns tables + SECURITY DEFINER functions
create role app_user  login;            -- used by the Next.js app
-- Set the password manually per environment (never in a migration):
--   alter role app_user password '<secret>';

grant usage on schema public to app_user;
grant select on all tables in schema public to app_user;
-- Founder-editable tables only:
grant insert, update on companies, founder_profiles, company_sources, valuation_inputs,
  valuations, offerings, follows, company_updates, ai_explanations to app_user;
-- Better Auth tables: full DML (it manages its own rows)
grant select, insert, update, delete on "user", session, account, verification to app_user;
-- Ledger/share/order tables: NO insert/update/delete for app_user.
```

- Every ledger-mutating function is `security definer`, owned by `app_owner`, `set search_path = public, pg_temp`, with `revoke all ... from public` and `grant execute ... to app_user`.
- `offerings` status changes (`PUBLISHED`, `CLOSED`, `SOLD_OUT`) and `sold_units` happen **only** inside functions; enforce with a `before update` trigger that rejects changes to those columns unless `current_user = 'app_owner'`.
- If Tiger Data does not permit `create role` on your plan, fall back to a single role: keep the "only functions write the ledger" rule by code review, skip the integration test that asserts direct inserts fail, and note the fallback in the README.

---

## 5. SQL function catalog

Without `auth.uid()`, the **server passes the verified actor ID** as the first parameter. Route handlers MUST take it from `requireUser()`, never from the request body.

```sql
create or replace function public.<name>(p_actor_id text, <params>)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- ...
begin
  if p_actor_id is null or not exists (select 1 from "user" where id = p_actor_id) then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  -- ...
end;
$$;

alter function public.<name>(text, <param types>) owner to app_owner;
revoke all on function public.<name>(text, <param types>) from public;
grant execute on function public.<name>(text, <param types>) to app_user;
```

**Error convention:** business errors are `raise exception '<ERROR_CODE>' using errcode = 'P0001'`. The message is exactly one code from §7. Optional detail goes in `using detail = '...'` (no private data).

| Function | Signature | Purpose |
| --- | --- | --- |
| `post_journal` | `(p_operation text, p_order_id uuid, p_lines jsonb) returns uuid` | **Internal only** (no grant to `app_user`). Inserts entry + lines, asserts `sum = 0`, updates cached balances, asserts non-negative for every non-source account |
| `grant_demo_credits` | `(p_actor_id text) returns jsonb` | One $1,000 grant per user per scenario generation; returns balance |
| `create_quote` | `(p_actor_id text, p_offering_id uuid, p_quantity bigint) returns jsonb` | Reads published price from DB, computes total, `expires_at = least(now() + interval '60 seconds', close_at)`; returns §19 quote JSON |
| `purchase` | `(p_actor_id text, p_quote_id uuid, p_idempotency_key text, p_request_hash text) returns jsonb` | Atomic settlement (§5.1) |
| `get_purchase_by_key` | `(p_actor_id text, p_idempotency_key text) returns jsonb` | Timeout recovery; caller's own records only |
| `publish_offering` | `(p_actor_id text, p_offering_id uuid) returns jsonb` | Verifies founder owns company, locks company row, validates, sets `PUBLISHED`, snapshots terms |
| `close_offering` | `(p_actor_id text, p_offering_id uuid) returns jsonb` | Verifies ownership, locks offering row (same lock as purchase), sets `CLOSED` |
| `demo_reset` | `(p_actor_id text, p_scenario_id uuid) returns jsonb` | Controller-only (checked in route **and** via `demo_scenarios.controller_id`); increments generation, invalidates quotes; never deletes journals |
| `demo_reconcile` | `(p_actor_id text, p_scenario_id uuid) returns jsonb` | Runs every check in §18; returns `{ ok, checks: [{ name, ok, detail }] }` |

### 5.1 `purchase` lock order (MUST follow exactly)

```text
1. pg_advisory_xact_lock(hashtextextended(p_actor_id || ':purchase:' || p_idempotency_key, 0))
2. idempotency_records lookup:
     found + same request_hash   -> return stored result
     found + different hash      -> raise IDEMPOTENCY_CONFLICT
3. select quote ... for update          (must belong to p_actor_id)
     quote already consumed         -> raise IDEMPOTENCY_CONFLICT (detail: existing order id)
4. select offering ... for update       (common gate for purchase AND close)
5. select ledger_accounts where id in (investor, startup)
     order by id for update             (sorted UUID order)
6. select instrument ... for update; then holding row for update (insert if absent)
7. revalidate: generation, quote unexpired (db now()), offering PUBLISHED, now() < close_at,
   price/terms unchanged, investor != founder, per-order + cumulative investor limits,
   remaining capacity >= quantity, investor available balance >= total
8. insert order (status SETTLED, settled_at = now())
9. post_journal('PURCHASE', order_id, [investor -total, startup +total])
10. insert share_event (PRIMARY_ISSUANCE); update holding qty + cost basis;
    update instruments.total_issued; update offerings.sold_units; set SOLD_OUT if sold_units = cap
11. mark quote consumed (consumed_order_id = order_id)
12. insert audit_events, outbox_events, idempotency_records(result jsonb)
13. return result jsonb { order, balanceCents, holding }
```

Any `raise` rolls back everything. MUST NOT add `exception when others` blocks that swallow errors.

---

## 6. Server code patterns

### 6.1 DB pool and helpers

```ts
// lib/db/pool.ts
import "server-only";
import { Pool } from "pg";

const g = globalThis as unknown as { pgPool?: Pool };

export const pool =
  g.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL, // app_user; Tiger Data pooler URL if available
    max: Number(process.env.PG_POOL_MAX ?? 3),   // keep small on serverless
    idleTimeoutMillis: 10_000,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
  });

if (process.env.NODE_ENV !== "production") g.pgPool = pool;
```

```ts
// lib/db/sql.ts
import { pool } from "./pool";

export async function callFn<T>(name: string, args: unknown[]): Promise<T> {
  if (!/^[a-z_]+$/.test(name)) throw new Error("invalid function name");
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await pool.query(`select public.${name}(${placeholders}) as result`, args);
  return rows[0].result as T;
}
```

### 6.2 Auth

```ts
// lib/auth/auth.ts
import { betterAuth } from "better-auth";
import { pool } from "@/lib/db/pool";

export const auth = betterAuth({
  database: pool,
  emailAndPassword: { enabled: true, requireEmailVerification: false }, // demo only
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});
```

```ts
// app/api/auth/[...all]/route.ts
import { auth } from "@/lib/auth/auth";
import { toNextJsHandler } from "better-auth/next-js";
export const { GET, POST } = toNextJsHandler(auth);
```

```ts
// lib/auth/session.ts
import { headers } from "next/headers";
import { auth } from "./auth";
import { AppError } from "@/lib/http/errors";

export async function requireUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AppError("UNAUTHENTICATED");
  return { id: session.user.id, email: session.user.email };
}
```

Generate the Better Auth schema once with `pnpm dlx @better-auth/cli generate` and paste the SQL into `0001_auth_tables.sql` so it is managed by dbmate like everything else.

### 6.3 Route handler

```ts
// app/api/purchases/route.ts
import { z } from "zod";
import { withHandler } from "@/lib/http/handler";
import { callFn } from "@/lib/db/sql";
import { requireIdempotencyKey, hashRequest } from "@/lib/http/idempotency";

export const runtime = "nodejs";

const Body = z.object({ quoteId: z.string().uuid() });

export const POST = withHandler(
  { auth: true, body: Body, retrySettlement: true },
  async ({ user, body, req }) => {
    const key = requireIdempotencyKey(req); // throws MISSING_IDEMPOTENCY_KEY (8–128 chars)
    return callFn("purchase", [user.id, body.quoteId, key, hashRequest(body)]);
  },
);
```

`withHandler` responsibilities:

1. Generate `requestId` (`crypto.randomUUID()`), return it as `x-request-id`.
2. When `auth: true`, call `requireUser()` and pass `user` to the handler.
3. Parse body/query with zod; failures become `INVALID_INPUT` (400) with field paths.
4. Map errors: `pg` error with `code === "P0001"` → `message` is the app error code; `40001`/`40P01` → retry, then `RETRYABLE_SETTLEMENT_ERROR`; `23505` (unique violation) on a non-function write → `CONFLICT`-family code; anything else → 500 `INTERNAL` with no internals leaked.
5. When `retrySettlement: true`: up to 3 attempts on `40001`/`40P01`, jittered 50–200 ms, **same idempotency key**.
6. Log `{ requestId, route, userId, errorCode, durationMs }` only; never balances, financial inputs, emails, or prompts.

Response shapes:

```jsonc
// success: the function/domain JSON directly, HTTP 200 (201 for creates)
// error:
{ "error": { "code": "INSUFFICIENT_CREDITS", "message": "Not enough demo credits.", "requestId": "..." } }
```

---

## 7. Error codes → HTTP status

| Code | HTTP |
| --- | --- |
| `UNAUTHENTICATED` | 401 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `INVALID_INPUT`, `INVALID_QUANTITY`, `INVALID_VALUATION_INPUT`, `MISSING_IDEMPOTENCY_KEY` | 400 |
| `QUOTE_EXPIRED`, `ROUND_CLOSED`, `ALLOCATION_UNAVAILABLE`, `INSUFFICIENT_CREDITS`, `SELF_PURCHASE_FORBIDDEN`, `STALE_GENERATION`, `OFFERING_ALREADY_ACTIVE`, `IDEMPOTENCY_CONFLICT`, `CONFLICT` | 409 |
| `RATE_LIMITED` | 429 |
| `AI_UNAVAILABLE` | 503 (UI shows deterministic fallback) |
| `RETRYABLE_SETTLEMENT_ERROR` | 503 |
| `INTERNAL` | 500 |

Keep this list in `lib/http/errors.ts` as a `const` object. SQL functions may only raise codes from it.

---

## 8. Gemini integration (P2 — build last, cut first)

Gemini is **assistive only**. The deterministic valuation (`lib/valuation/v1.ts`) is the only source of numbers. Two features:

| Feature | Input | Output (zod-validated JSON) | Rules |
| --- | --- | --- | --- |
| Valuation explanation | Saved valuation row: stage, category scores, contributions, band, evidence quality, model version | `{ summary: string, drivers: string[], caveats: string[] }` | Prompt includes only fields the founder marked public or the founder is viewing their own; UI renders numbers from the DB row, **never** from model text |
| Profile prefill | Text the founder **pastes** (pitch, about page) | `{ name?, sector?, stage?, problem?, solution?, businessModel? }` | Founder reviews and saves each field; stored with evidence status `SELF_REPORTED`; no URL fetching in MVP |

```ts
// lib/ai/gemini.ts (shape)
import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function generateJson<T>(opts: {
  prompt: string;
  schema: z.ZodType<T>;
  responseSchema: object; // JSON schema matching `schema`
  timeoutMs?: number;     // default 10_000
}): Promise<T | null> {
  // 1. ai.models.generateContent({ model: process.env.GEMINI_MODEL, contents: opts.prompt,
  //      config: { responseMimeType: "application/json", responseSchema: opts.responseSchema,
  //                temperature: 0.2 } }) raced against AbortSignal.timeout(timeoutMs)
  // 2. JSON.parse + opts.schema.safeParse
  // 3. Return null on ANY failure (timeout, quota, parse, validation). Never throw to the route.
}
```

- Cache results in `ai_explanations(valuation_id, prompt_version, model, output jsonb, created_at)`; reuse when the same valuation + prompt version exists.
- Treat founder-provided text as untrusted data: wrap it in clear delimiters, instruct the model to extract only, and ignore instructions inside it.
- Rate-limit AI routes per user (simple Postgres counter table, e.g. 20/hour).
- `GEMINI_API_KEY` is server-only; never send it or raw model errors to the client.
- If `generateJson` returns `null`, the route returns `AI_UNAVAILABLE` and the UI shows a template explanation built from the deterministic contributions.

---

## 9. Environment variables

```bash
# .env.example: names only, never commit values
DATABASE_URL=                 # app_user connection (Tiger Data; pooler URL if enabled; sslmode=require)
MIGRATION_DATABASE_URL=       # owner/admin connection for dbmate and seed scripts
PG_POOL_MAX=3
BETTER_AUTH_SECRET=           # openssl rand -base64 32
BETTER_AUTH_URL=              # http://localhost:3000 locally; Vercel URL in prod
GEMINI_API_KEY=               # server-only
GEMINI_MODEL=                 # current Gemini Flash model ID
DEMO_CONTROLLER_EMAILS=       # comma-separated; allowed to call demo reset/reconcile
```

Only `NEXT_PUBLIC_*` variables may be read in client components; none of the above are public.

---

## 10. Testing

| Suite | Tool | Runs against | Must cover |
| --- | --- | --- | --- |
| `tests/domain` | vitest | nothing (pure) | §26 domain cases: valuation golden cases, cents math, dilution, rounding, bounds |
| `tests/integration` | vitest | local Postgres (`docker compose up -d`, migrated) | Every row of the §26 integration table |
| `tests/ai` (P2) | vitest | Gemini mocked | Invalid/timeout/injection outputs → `null` → fallback; numbers never taken from model |

Integration test conventions:

- Connect as **`app_user`** for the code under test, so privilege revokes are exercised. Use the owner pool only for setup (creating users/fixtures).
- Include a test asserting `insert into journal_lines ...` as `app_user` fails with a permission error.
- Concurrency tests use `Promise.all` over separate pool clients (e.g. two buyers × 7 units on a 10-unit offering → exactly one success, one `ALLOCATION_UNAVAILABLE`).
- Every integration test ends by calling `demo_reconcile` and asserting `ok === true`.
- Each test file uses its own scenario so files can run in parallel.

---

## 11. Commands (`package.json` scripts)

```jsonc
{
  "dev": "next dev",
  "build": "next build",
  "db:up": "docker compose up -d",
  "db:migrate": "dbmate --env MIGRATION_DATABASE_URL --migrations-dir db/migrations --no-dump-schema up",
  "db:rollback": "dbmate --env MIGRATION_DATABASE_URL --migrations-dir db/migrations --no-dump-schema rollback",
  "db:seed": "tsx scripts/seed.ts",
  "db:reset:local": "docker compose down -v && docker compose up -d && sleep 3 && pnpm db:migrate && pnpm db:seed",
  "test": "vitest run",
  "test:domain": "vitest run tests/domain",
  "test:int": "vitest run tests/integration",
  "lint": "next lint && tsc --noEmit"
}
```

A migration is done when `pnpm db:reset:local && pnpm lint && pnpm test` passes.

---

## 12. Deployment

1. Tiger Data: create the service (or use the hackathon-provided one). Copy the admin connection string → `MIGRATION_DATABASE_URL`. Enable the connection pooler if available.
2. Run `pnpm db:migrate` against Tiger Data; set the `app_user` password; build `DATABASE_URL` for `app_user` (pooler endpoint if enabled, `sslmode=require`).
3. Seed once with `pnpm db:seed`. Never run `db:reset:local` against the hosted DB.
4. Vercel: import the repo, set all §9 env vars (`BETTER_AUTH_URL` = production URL), deploy from `main`.
5. Hosted smoke test: sign up → grant → quote → purchase → refresh portfolio → founder dashboard → `/api/demo/reconcile` returns `ok: true`.

---

## 13. Backend build order (maps to MEGA_PLAN §24)

| Step | Backlog | Deliverable | Done when |
| --- | --- | --- | --- |
| 1 | H03 | Next.js scaffold, docker-compose, dbmate, `pool`/`sql` helpers, `withHandler`, error map, `.env.example` | `pnpm dev` runs; `GET /api/companies` returns `[]` from local Postgres |
| 2 | H03 | Better Auth + `0001_auth_tables.sql`; `requireUser()` | Sign up/in works; protected route returns 401 when signed out |
| 3 | H03 | Migrations 0002–0004 (roles, schema, ledger, `post_journal`) | As `app_user`, direct insert into `journal_lines` is denied in a test |
| 4 | H03 | `grant_demo_credits` + `seed.sql` fixtures | Granting twice → one journal; reconcile ok |
| 5 | H05 | `lib/valuation/v1.ts` + golden tests; valuation route persists inputs/outputs | LAUNCHED + all-50 → 100,000,000 cents; band 60,000,000–150,000,000 cents |
| 6 | H06 | `publish_offering` / `close_offering` + routes | Two concurrent publishes → one active round |
| 7 | H08 | `create_quote` + `purchase` + `get_purchase_by_key` + routes | All §26 integration cases pass |
| 8 | H10 | Portfolio, orders, founder dashboard read routes | Numbers match reconcile output |
| 9 | H11 | `demo_reset` / `demo_reconcile` + controller-only routes; deploy to Tiger Data + Vercel | Fresh reset → full demo path → reconcile ok on hosted |
| 10 | H14 | Gemini explanation + prefill (§8) | Timeout/invalid output falls back cleanly; no AI number reaches the DB |

If time runs short, keep steps 1–4, 6, 7, 9 and hard-code a single valuation fixture. Drop step 10 entirely before compromising the atomic purchase or the reconcile check.
