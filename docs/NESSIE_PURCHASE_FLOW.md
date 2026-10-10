# Prospecto — Nessie funding and startup purchase flow

Status: complete design for implementation; no backend, Anchor program, or live Nessie integration is supplied by this document. Updated October 10, 2026.

This extends [MARKET ARCHITECTURE.md](MARKET%20ARCHITECTURE.md) and [BACKEND_STACK.md](BACKEND_STACK.md), following [AGENTS.md](../AGENTS.md). It replaces the abbreviated funding saga in BACKEND_STACK §9 and refines its retry, transaction-status, and event-deduplication rules. Existing valuation weights, prices, pro-rata allocation, and fee percentages remain unchanged. Frontend files under `web/` and `landing/` remain owned by the frontend contributor.

## 1. Decisions and scope

**Nessie simulates banking, Solana Devnet settles participation, Tiger stores product data and a recovery trail.** Nessie is not a securities API, identity check, real bank connection, or source of startup receipt ownership. All balances are fictional. Tokens are mock USDC-style Devnet tokens; project assets are non-transferable participation receipts, with no ownership, redemption, or automatic equity-conversion promise.

Use the current stack: static Next.js frontend, Hono/TypeScript modular backend, parameterized `pg` access to Tiger PostgreSQL, one worker, and the Anchor program. No separate payment service or new queue infrastructure.

There are two separate user actions:

1. **Fund demo wallet:** move fictional dollars from the participant's Nessie Checking account to the platform's Nessie funding account; mint the equivalent mock tokens after verified banking success.
2. **Participate in a startup round:** transfer existing mock tokens into the startup round vault. At close, allocate units, split fees, and refund excess according to the existing formula.

Funding is not a subscription. A funded wallet can participate in multiple projects. Never debit Nessie again when subscribing, and never record both a Nessie merchant purchase and a transfer for the same funding. Founder proceeds remain Devnet tokens; bank payouts and token-to-bank redemption are outside this MVP.

Current product scope is direct primary participation only. End-of-round pro-rata allocation means the first click records a commitment, not immediate receipt ownership. The round stays open until its scheduled close even if commitments reach its target. `Filled` is a progress indicator, not an early-close trigger in this implementation.

### Acceptance criteria

- One demo user can fund a verified wallet using an actual Nessie sandbox request, then commit mock tokens to a startup round.
- A retried app request returns the original intent; it does not repeat the banking write or token mint.
- An uncertain Nessie response stops further writes until reconciled. A missing Solana signature does not authorize a second mint.
- Finalized on-chain state is authoritative for balances, allocations, fees, receipts, and refunds.
- Founder/team self-participation and a second subscription through another wallet of the same identity are rejected.
- UI distinguishes bank processing, wallet funding, commitment, final allocation, and refunds.
- Demo shows both sponsor API data and finalized settlement identifiers, with simulation labels.

## 2. Architecture and trust boundaries

```mermaid
sequenceDiagram
    participant U as Participant browser + wallet
    participant A as Hono API
    participant D as Tiger PostgreSQL
    participant W as Worker
    participant N as Nessie mock bank
    participant S as Solana Devnet program
    U->>A: POST funding + request key
    A->>D: Persist intent, limits, and funding reservation
    A-->>U: 202 + funding ID
    W->>D: Claim durable intent
    W->>N: Transfer mock dollars to funding treasury
    W->>N: Read transfer until verified terminal success
    W->>D: Record verified bank result
    W->>S: fund_mock_usdc(intent ID, wallet, amount)
    S->>S: Create FundingReceipt PDA + mint atomically
    W->>D: Record finalized receipt and mark completed
    U->>A: Prepare round subscription
    A->>D: Reserve identity/round attempt + store exact message
    A-->>U: Relayer-partially-signed transaction + preview
    U->>U: Sign using wallet
    U->>A: Submit exact signed transaction
    A->>S: Submit; track confirmation
    S->>S: Move tokens to round vault + create subscription atomically
    W->>S: After close: finalize, mint allocation, refund excess
    W->>D: Index finalized outcomes and refresh dashboards
    U->>A: Read subscription receipt and portfolio
```

| Domain | Authority | Trust rule |
| --- | --- | --- |
| Sessions, wallet binding, eligibility | Tiger | Server derives identity from session; wallet ownership requires signature proof. |
| Mock bank accounts/transfers | Nessie | Only server-managed account mappings; browser cannot choose arbitrary payer/payee IDs. |
| Funding lifecycle and dispatch ownership | Tiger | Durable states before external calls; state transitions use row locks/CAS. |
| Funding token mint and replay protection | Solana FundingReceipt PDA | One mint per immutable intent, not a balance-delta guess. |
| Subscriptions and receipt issuance | Solana program accounts | DB is a mirror; endpoint success does not prove settlement. |
| Valuation and evidence | Tiger immutable snapshots | Freeze before opening; AI output cannot authorize money movement. |

Do not hold a database transaction open while calling Nessie or RPC. Persist, commit, perform external work, then record the observed outcome in another short transaction.

## 3. Nessie API contract and evidence

The current [Nessie documentation](https://prod.nessieisreal.com/docs) describes query-parameter API-key authentication; its Quick Start includes `POST /accounts/{id}/transfers`. Its Transfers panel shows an example status of `completed`. The server selector observed on October 10, 2026 is `https://prod-api.nessieisreal.com`.

The provider's [Android TransferService](https://github.com/nessieisreal/nessie-android-sdk/blob/master/nessie-android-sdk/src/main/java/com/reimaginebanking/api/nessieandroidsdk/requestservices/TransferService.java) also documents transfer creation, account transfer history, and transfer lookup. Its [create-response fixture](https://github.com/nessieisreal/nessie-android-sdk/blob/master/nessie-android-sdk/src/test/resources/__files/transfer/post-transfer.json) is legacy evidence: `201`, an `objectCreated` wrapper, and a `pending` status. Do not mistake that fixture for a live test. The old JavaScript SDK's transfer-creation implementation points to withdrawals; do not copy it.

**Capability gate before implementation:** a team member must use the team's sandbox key to confirm the host, request schema, response envelopes, transfer-history visibility, amount units, terminal-status semantics, and whether successful transfers update both balances. No API key was supplied for this design, and no authenticated requests were run. API-key idempotency headers, webhooks, cancellation guarantees, balance holds, instant completion, and a fixed execution delay are not assumed.

Configure a tested adapter profile. The current docs' `completed` example and historical statuses must not be accepted interchangeably without confirming their behavior on the configured host. Unknown statuses fail closed.

| Operation | Endpoint | Use |
| --- | --- | --- |
| Create fictional profile | `POST /customers` | Seed/setup only, synthetic name and address. |
| Create Checking account | `POST /customers/{customerId}/accounts` | Seed participant and platform funding accounts. |
| Read account | `GET /accounts/{accountId}` | Balance display and conservative funding check. |
| Fund wallet | `POST /accounts/{payerAccountId}/transfers` | Participant account → configured platform account. |
| Read transfer | `GET /transfers/{transferId}` | Verify status, amount, parties, and correlation tag. |
| Find an uncertain transfer | `GET /accounts/{accountId}/transfers` | Read history; endpoint supported by provider SDK, verify current deployment. |
| Read bills | `GET /accounts/{accountId}/bills` | Optional mock budget display. |

Example transfer body, pending validation against the team's live sandbox contract:

```json
{
  "medium": "balance",
  "payee_id": "SERVER_CONFIGURED_TREASURY_ACCOUNT_ID",
  "amount": 100,
  "transaction_date": "2026-10-10",
  "description": "prospecto:funding:IMMUTABLE_INTENT_UUID"
}
```

Never send `status` to force success. Success must be read back from Nessie. The exact description tag is a correlation aid; it is not provider-enforced idempotency. Verify payer, payee, amount, tag, and provider ID before accepting a matching record. A `201` creation response is not terminal banking success.

### Amount representation

- Public API: micro-USD decimal strings, e.g. `"100000000"` for $100.
- TypeScript: BigInt. PostgreSQL: `bigint` (Postgres has no unsigned 64-bit type; app and program caps keep amounts far below 2^63). Solana: checked u64 amounts with u128 intermediates for multiplication.
- UI: show dollars, not micro-USD (`$100.00`; unit prices and sub-cent dust up to six decimals), formatted from BigInt without floating point.
- MVP bank funding accepts whole simulated dollars only: `amountMicroUsd % 1_000_000 = 0`. This fits the current integer-amount documentation without rounding losses.
- The adapter converts to a bounded integer dollar `number` only at the Nessie wire boundary; never convert token allocation values through floating point.
- Preserve six decimals for subscriptions/refunds. A $0.50 token refund remains $0.50 in the wallet even though whole-dollar bank funding is required.
- Bounds: positive amount, at most $1,000 cumulative lifetime mock funding per demo identity, one accepted intent per rolling hour, and one unresolved funding intent per source account. Include unresolved intents in limit usage until conclusively failed or compensated.

## 4. Setup and ownership

A privileged seed script creates synthetic participant customers/accounts with a $1,000 starting balance and a zero-balance platform funding account. Use fixture aliases, not real names, addresses, bank data, or credentials. Never place a seeded identity's account under another user's mapping.

Persist a seed manifest and provider IDs before admitting funding. Account/customer creation has the same uncertain-write risk as transfers: no blind POST retries, and no repeated seeding on every login. If creation has an uncertain result, reconcile or manually resolve it first. The initial bank balance is the seed; do not also issue an independent deposit or grant tokens for that seed.

`GET /api/banking/account` returns a sanitized view of the caller's mapped account and its observation timestamp. Raw provider IDs are private implementation details. Switching verified wallets does not reseed the bank account, reset quotas, or create a new campus identity.

Environment additions, values kept in deployment secrets:

```text
NESSIE_API_KEY=
NESSIE_BASE_URL=                 # HTTPS tested API host, not documentation host
NESSIE_PROFILE=                 # pinned, tested wire/status profile
NESSIE_TREASURY_ACCOUNT_ID=
NESSIE_ENABLED=true
FUNDING_PAUSED=false
DEMO_GENERATION_ID=              # namespace for fresh seeded demo fixtures
```

Never put the key in `NEXT_PUBLIC_*`, browser requests, repo contents, screenshots, telemetry, or raw request URLs. Since Nessie uses a `key` query parameter, redact URL queries in HTTP tracing and error reports. Do not automatically follow redirects carrying the key to another host. Restrict base URL to the configured trusted HTTPS API host.

## 5. Durable data model

All tables below are ordinary relational tables. State changes are recorded in append-only transition records; corrected provider observations append new evidence. These are additions to the existing schemas, not a second balance ledger.

| Table | Required fields/constraints |
| --- | --- |
| `banking_accounts` | UUID, generation, identity ID nullable for treasury, role, provider customer/account IDs, active flag, last observed integer balance/time; unique provider account per generation and identity/role mapping. |
| `funding_intents` | UUID, generation, identity ID, wallet, amount micro-USD, mode `NESSIE`/`FAUCET_ONLY`, source/treasury mapping, idempotency key/hash, status, correlation tag, immutable provider profile, timestamps, last error, retry time; unique identity/key and unique tag. |
| `banking_attempts` | Intent ID, attempt ordinal, request hash, dispatch state, sent time, outcome, provider transfer ID/status, sanitized parsed response; unique bound provider transfer ID. |
| `funding_chain_attempts` | Intent ID, attempt ordinal, message hash, signed tx bytes restricted to server/worker, signature, blockhash, last-valid block height, status; signature unique. |
| `funding_transitions` | Intent ID, from/to state, observed evidence hashes/IDs, actor/worker, time, reason. |
| `subscription_intents` | Identity, round, wallet, gross amount, idempotency hash, exact transaction message/hash, signature, blockhash expiry, state, preview snapshot; unique active or completed identity/round. |
| `worker_leases` or lease fields | Intent ID, worker owner, expiry, fencing counter; CAS required to advance work. |

A partial unique constraint permits at most one unresolved funding per mapped source account. Failed or proven bank-compensated intents may release this gate, but their history remains. Funding with chain outcome unknown keeps the gate.

Subscription identity uniqueness cannot rely only on the chain's wallet-based PDA. Reserve `(round_id, identity_id)` before relayer signing and keep it reserved while any signed attempt can still land. Confirmed/finalized participation permanently consumes that identity's one subscription for the round. Do not release it just because a browser disappears or a worker timer expires.

Extend `chain_events` dedupe to `(chain, signature, instruction_index, event_index)`: one instruction can emit multiple events. Keep mint/allocation amounts finalized-only in authoritative dashboard totals. Provisional observations stay distinguishable and can be retracted. Rebuild aggregates from finalized canonical events plus immutable off-chain data.

## 6. Funding state machine and recovery

```text
CREATED → BANK_DISPATCHED → BANK_PENDING → BANK_CONFIRMED
                   ↘ BANK_UNKNOWN             ↓
                     NEEDS_REVIEW       MINT_PREPARED → MINT_SUBMITTED
BANK_PENDING → BANK_REJECTED                     ↓
                                            MINT_CONFIRMED → COMPLETED
BANK_CONFIRMED → compensation (only after proving no mint can execute)

FAUCET_ONLY uses a separate, visibly labeled path; it cannot replace an
already-dispatched NESSIE intent.
```

Persist funding status as an explicit enum: `CREATED`, `BANK_DISPATCHED`, `BANK_PENDING`, `BANK_UNKNOWN`, `BANK_CONFIRMED`, `BANK_REJECTED`, `MINT_PREPARED`, `MINT_SUBMITTED`, `MINT_CONFIRMED`, `COMPLETED`, `NEEDS_REVIEW`, `COMPENSATION_PREPARED`, `COMPENSATION_PENDING`, `COMPENSATION_UNKNOWN`, `COMPENSATED`. Mode is a separate enum, not a successful status. A new, explicitly selected `FAUCET_ONLY` intent reserves the same limits and goes from `CREATED` directly to `MINT_PREPARED`, using a proof hash in a separate faucet domain and no provider-transfer fields. Its completion remains visibly faucet-only. Existing Nessie-mode intents never change mode. Validate permitted transitions under a row lock/CAS; bank-rejected and compensated are terminal no-mint outcomes. A review resolution must cite provider/chain evidence and record its actor.

`BANK_CONFIRMED` requires the configured terminal-success predicate and verified parties/amount/tag. `MINT_CONFIRMED` is provisional; `COMPLETED` requires a finalized FundingReceipt account with the same intent, wallet, mint, and amount, plus the successful matched bank observation. Do not infer completion from wallet balance changes: spending, unrelated funding, and retries make balance deltas ambiguous.

### Step A — accept the request

`POST /api/funding` requires a session, campus eligibility, verified wallet, Origin check, idempotency key, and amount validation. Server chooses the mapped source and configured treasury.

In one short DB transaction, lock the source/identity quota row, compare the request hash, check the rolling-hour and cumulative limits, ensure no unresolved intent, create the intent and reservation, and store the accepted response. Commit before external calls. Return `202` with an intent ID and polling URL.

Hash canonical UTF-8 JSON with sorted keys, no insignificant whitespace, normalized decimal amount strings, operation name, generation ID, and all immutable request fields (including wallet). Same key/same body returns the same intent and latest status. Same key/different body returns `409 IDEMPOTENCY_CONFLICT`. A new key does not bypass quotas or an unresolved prior intent.

### Step B — execute the banking write once

The worker performs a fresh account read; subtract other intents' unresolved app reservations conservatively when checking spendable mock funds for this intent; do not subtract the current intent and then require its amount a second time. Local reservations are not Nessie bank holds. Account edits made outside Prospecto can still race; the participant account must be exclusively controlled by this demo.

Persist the exact request hash/tag and `BANK_DISPATCHED` before sending the POST. Claiming an intent uses `FOR UPDATE SKIP LOCKED` or compare-and-swap; do not keep locks during HTTP. One dispatch record is the gate, not a renewable lease alone: another worker must not resend a bank POST after a lease expires.

A response with a valid ID becomes `BANK_PENDING` or `BANK_CONFIRMED` after read-back. Timeouts, malformed success bodies, connection loss after possible send, and ambiguous server errors become `BANK_UNKNOWN`. A crashed `BANK_DISPATCHED` state is also uncertain, even if the call may never have left the process.

Definitive rejection must be supported by the tested provider response semantics; do not assume every HTTP error proves no mutation. Release limits only when failure/no effect is conclusive. No hidden automatic POST retry middleware.

### Step C — reconcile uncertain banking results

Use transfer ID if known; otherwise inspect all relevant pages of source-account history for the exact tag and matching tuple. Poll read endpoints with bounded backoff. Suggested demo schedule: 2 s, 5 s, 10 s, 30 s, then 60 s; these are app settings, not promised provider execution times.

- One matching pending transfer: bind its ID, continue status reads.
- One matching terminal-success transfer: verify and proceed.
- Multiple matches, unexpected amount/parties, unknown status: `NEEDS_REVIEW`, freeze this source account's funding.
- No visible match: keep uncertain; absence in one list response is not proof that a delayed write cannot appear.

If history lookup is unsupported or cannot establish certainty, require explicit operator resolution. The adapter does not claim exactly-once provider execution when Nessie offers no confirmed idempotency contract. We choose waiting over a possible double debit.

### Step D — mint with an on-chain replay guard

Add Anchor instruction `fund_mock_usdc(intent_id_16_bytes, amount_micro_usd, bank_proof_hash_32_bytes)` and account `FundingReceipt` at seeds `["funding", intent_id]`. The instruction requires the configured relayer signer, an unpaused Config, a positive amount at most `1_000_000_000` micro-USD ($1,000), the configured payment mint/token program, and the intended verified wallet's destination ATA. The backend has already checked bank success; the chain trusts this relayer assertion and does not call Nessie.

On first execution, atomically create the receipt account and CPI mint the exact amount. Store intent ID, wallet, amount, payment mint, bank-proof hash, and funded flag. Compute the proof hash from canonical provider transfer ID/parties/amount/intent fields; keep the raw banking record off-chain. Use SHA-256 over sorted-key canonical UTF-8 JSON with keys `version`, `mode`, `intentId`, `providerTransferId`, `payerId`, `payeeId`, and `amountMicroUsd` (all IDs/amount strings; version `1`). Persist these inputs once; exclude timestamps and mutable provider status. This encoding must not change across retries/deployments. The receipt is audit state, not a user-tradable token.

Never close/reset FundingReceipt accounts: their persistent existence is the mint replay guard. The relayer pays account rent and Devnet transaction fees. If that PDA already exists, verify every immutable field; matching requests return without minting again, mismatches fail. Include bank-proof hash in the replay-field comparison. Emit one `MockWalletFunded` event only on first execution. This guard survives process crashes and new transaction signatures. Merely testing `mint_signature IS NULL` is insufficient.

For this Devnet MVP, the existing relayer remains the mock token mint authority and signs the CPI. Restrict application code to this guarded instruction; direct MintTo bypasses the replay guard and must not be used. This is a trusted demo authority, not a trustless bank-to-chain bridge.

Persist the fully signed transaction, signature, blockhash, expiry, and request proof before submitting. Retry the same bytes/signature while valid. After proven expiry, read finalized FundingReceipt state and signature history before creating a new transaction. A new transaction still uses the same intent PDA.

### Step E — finish or compensate

Once the receipt is finalized, mark completed and release the unresolved-account gate. Keep cumulative funded totals consumed. A later banking contradiction after minting pauses new funding and creates a review incident; do not issue a second mint or refund bank dollars while spendable mock tokens still exist.

Recoverable chain errors remain retryable after successful bank transfer. If permanently abandoning an intent, compensation may transfer the same mock dollars from treasury back to the participant, but only after proving all funding transactions are expired/failed, the funding receipt is absent, and the intent is blocked from future minting. Compensation has its own persisted tag, uncertain-write handling, and operator authorization. If proof is unavailable, leave review pending. Never use deleting or editing an executed bank record as a refund.

## 7. Startup subscription from preparation to receipts

### Prepare

`POST /api/rounds/:id/subscribe/prepare` takes `walletAddress` and `grossAmountMicroUsd` as a decimal string plus an idempotency key. No banking IDs, fee values, or prices are client-authoritative.

Read the current round PDA and configured mint, require an open/unpaused round and eligible identity, reject founder/team membership, check wallet binding and finalized token balance, enforce the round cap, and reserve the identity's single participation attempt. Price/model hashes come from the opened round.

Build only the intended subscribe instruction plus explicitly permitted ATA/compute-budget setup. Fix expected program IDs, accounts, mint, amount, relayer fee payer, blockhash, and recipient vault in the stored message. Partially sign with the relayer and return the preview and expiry metadata. Repeated requests return the same attempt; an expired attempt is refreshed under the same intent only after the previous attempt cannot land.

### Sign and submit

The user's wallet signs. They can reject signing without any bank debit or token movement. The API must check the submitted message bytes against the stored prepared message, validate all required signatures and wallet ownership, and enforce size/rate limits before RPC submission. Never offer a relayer endpoint that signs arbitrary browser-provided transactions.

Persist the signed bytes and signature before RPC submission. `sendTransaction` success means submission only, not confirmation. Return a signature and tracking endpoint. Resubmit identical bytes safely when the transport outcome is uncertain; never mark failure on a two-minute timeout alone.

The program checks time, price bounds, maximum gross, mint/accounts, founder wallet, relayer signer, and one wallet subscription per round; checked integer arithmetic applies. Payment transfer into the round vault and creation of the Subscription PDA happen atomically. If the instruction fails, mock tokens are not debited; the relayer may still pay a Devnet SOL network fee.

The server's identity reservation plus relayer signing prevents a second verified wallet from bypassing identity limits. Direct submission of a previously signed transaction is possible; this is why a reservation cannot be released before its blockhash expires and the chain result is reconciled.

### Track

Transaction states: `Prepared → Submitted → Confirmed → Finalized`, with explicit `Rejected`, `Expired`, and `Unknown` outcomes as appropriate. A null signature status is not a conclusive failure. Use signature history, last-valid block height, and relevant PDA state; finalized subscriptions remain the final authority. If a provisional observation disappears, retract its provisional mirror and re-evaluate.

The UI shows “Committed — allocation after round close” for finalized subscription payment. Receipt balances update only after finalized allocation minting. Pending estimated units are never labeled owned units.

## 8. Round settlement, fees, refunds, and cancellation

Keep BACKEND_STACK §6.3 arithmetic exactly. Given buyer gross `g`, all-round committed total `G`, target `T`, unit price `p`, fee basis points `b`, and founder fee-share basis points `f`:

```text
accepted = g                         if G <= T
accepted = floor(g * T / G)          otherwise
fee = floor(accepted * b / 10_000)
founder_reward = floor(fee * f / 10_000)
platform_revenue = fee - founder_reward
project_proceeds = accepted - fee
units = floor(project_proceeds / p)
refund = g - accepted
unit_dust = project_proceeds - units * p
```

Use u128 intermediates and checked conversions back to u64. Default example `b=100` (1%), `f=4000` (40% of fee). The existing rule keeps sub-unit dust in project proceeds; do not silently change it or present price as gross dollars per received unit. The UI must display gross, fee, estimated units, possible pro-rata reduction, and dust policy. Small pro-rata allocations can produce zero whole units; disclose this and include a zero-unit golden case. Changing that policy requires a separately versioned settlement decision.

The target is an upper bound, not a minimum-success threshold; an undersubscribed round still settles under current rules. In a pro-rata round, target attainment does not guarantee minting exactly `max_units`, because fees and unit flooring reduce allocation.

After `closes_at`, the worker finalizes once. For each subscription it runs guarded allocation minting/fee splits and `refund_excess`, preferably in one transaction when it fits. Existing `minted` and `refunded` flags enforce at-most-once effects. If separate transactions are necessary, track each leg; the round header being finalized does not mean every participant is settled.

A refund returns mock tokens from the round vault to the verified subscribing wallet. It does not reverse wallet funding in Nessie: the participant still owns the returned wallet tokens. Canceled rounds accept zero, mint zero receipts, charge zero fees, and refund full gross once. Cancellation must be rejected after finalization or any allocation payout.

A founder withdrawal transfers Devnet project proceeds/rewards to the founder wallet and is indexed. No automatic bank deposit, withdrawal, merchant purchase, or Nessie startup-account credit occurs. That would introduce another conversion flow and double-count this demo's funds.

### Golden example

A participant funds $100 through Nessie and receives `100000000` micro-USD mock tokens. They commit all $100 to a round at $1 per unit, with the example fee rules and no oversubscription:

| Result | Amount |
| --- | --- |
| Nessie participant balance | $1,000 → $900 |
| Nessie funding treasury | $0 → $100 |
| Wallet after funding | +$100 mock tokens |
| Wallet after commitment | $0 mock tokens |
| Project proceeds | $99 mock tokens |
| Founder fee reward | $0.40 mock tokens |
| Platform fee revenue | $0.60 mock tokens |
| Participation receipts | 99 units |
| Excess refund | $0 |

The bank treasury's $100 and the chain's $100 are two representations of a simulated funding action, not $200 of economic proceeds. There is no redemption peg or reserve/custody claim.

More examples are in [nessie-purchase-cases.json](fixtures/nessie-purchase-cases.json).

## 9. API contract for the frontend owner

All paths use the existing `/api` server. Authenticated mutations require same-origin checks and a scoped idempotency key. Return decimal strings for every micro-USD or unit amount, and ISO timestamps.

| Method/path | Request | Response/use |
| --- | --- | --- |
| GET `/banking/account` | Session | Sanitized nickname, fictional balance, observation time, active funding, mode. |
| GET `/banking/activity` | Session | Sanitized mapped-account transfer history with intent links/statuses; never other users' IDs or raw provider payloads. |
| POST `/funding` | `{walletAddress, amountMicroUsd}` | `202 {fundingId, status, mode, pollUrl}`. |
| GET `/funding/:id` | Owner only | Latest state, permitted next action, masked bank reference, chain signature, error code. |
| GET `/funding/by-key?key=...` | Owner only | Recover a response lost before the client saved the ID; key is app-only, not Nessie key. |
| GET `/wallet/balance?address=...` | Bound wallet | Finalized mock token balance and network/mint label. |
| POST `/rounds/:id/subscribe/prepare` | `{walletAddress, grossAmountMicroUsd}` | Subscription intent ID, co-signed tx, blockhash/expiry, preview. |
| POST `/transactions` | `{intentId, signedTx}` | `202 {signature, status, pollUrl}`; exact-message check. |
| GET `/transactions/:signature` | Intent owner | Confirmation, expiry, error, explorer URL for Devnet. |
| GET `/rounds/:id/subscriptions/me` | Session | Gross, accepted, fee split, units, refund, each leg's status/identifiers. |
| GET `/portfolio` | Session | Finalized allocations by project/round, remaining receipt token balances, pending commitments. |

These extend existing endpoints rather than introducing `/purchases` as a competing settlement API. Read-only poll requests do not dispatch new banking transfers. Browser polling backs off and stops on terminal results; suggested 2 s initially then 5–10 s while active.

Example completed funding response:

```json
{
  "fundingId": "uuid",
  "status": "COMPLETED",
  "mode": "NESSIE",
  "amountMicroUsd": "100000000",
  "walletAddress": "verified-address",
  "bankReference": "masked-provider-reference",
  "mintSignature": "devnet-signature",
  "confirmation": "finalized",
  "simulation": true
}
```

Error shape stays `{error:{code,message,requestId}}`. Add `BANK_ACCOUNT_NOT_READY` 409, `FUNDING_IN_PROGRESS` 409, `FUNDING_LIMIT` 409, `INSUFFICIENT_MOCK_BANK_BALANCE` 409, `INSUFFICIENT_MOCK_TOKEN_BALANCE` 409, `TRANSACTION_MESSAGE_MISMATCH` 400, `BANK_UNAVAILABLE` 503. An already accepted intent becoming pending/review is returned as an intent state, not a misleading failed checkout. Store sanitized codes; never expose raw upstream URLs/errors.

## 10. Workers and reconciliation

One existing worker handles durable jobs; no new broker. Short SQL claims use leases and fencing. Banking dispatch records additionally prevent resends after lease loss. Scan resumable intents at startup.

- Funding loop: pending/unknown banking reads, guarded token mint, finalized receipt verification, quota/account gate updates.
- Chain ingest: only successful transactions for the expected program/cluster; parse stable event ordering, dedupe multiple events per instruction, mirror committed/allocation/refund legs, then produce metrics in one DB transaction.
- Finalization loop: close rounds by on-chain time, crank unfinished allocations/refunds, maintain separate “all subscriptions settled” completion.
- Reconciliation loop: backfill signature history through pagination and a durable cursor; advance cursor only after all fetched events are committed. Re-read program accounts, promote finality, retract dropped provisional observations, and compare derived totals.

For each completed Nessie-mode funding, verify one uniquely bound bank transfer plus one FundingReceipt with the same intent/amount/wallet. Reconcile provider-account totals against seeds and known transfers where fixture isolation permits. Differences create review incidents; balance deltas alone cannot establish the cause.

For each round assert `accepted + refund = gross`, `fee = founder_reward + platform_revenue`, `project_proceeds + fee = accepted`, `units * price + dust = project_proceeds`, `sum accepted <= target`, `sum units <= max_units`. Validate vault conservation against unsettled commitments and settled/refunded totals; record completed withdrawals separately.

Portfolio holdings derive from finalized allocations and actual receipt-token state. Token-2022 non-transferability does not imply non-burnability: a holder can burn receipts, so current token balance can be below cumulative issued allocation. Label those quantities separately.

Observability: correlation IDs, state ages, uncertain-bank count, duplicate-intent rejection count, mint/receipt mismatches, pending settlement legs, indexer lag, and wallet funding duration. Logs contain IDs and codes only. A private operator read view can inspect recovery evidence and pause funding; it cannot mark a financial outcome successful without evidence.

## 11. Failure matrix

| Failure | Required outcome |
| --- | --- |
| Double-click/retry | Same intent/transaction; no second write or mint. |
| New request key while bank pending | `FUNDING_IN_PROGRESS`; existing intent remains recoverable. |
| Nessie POST timeout/crash after dispatch | Unknown → lookup/review; never blind POST again. |
| Nessie `201` + pending | Show bank processing; no tokens yet. |
| Provider terminal rejection | No mint; release reservation only on conclusive no effect. |
| Unknown or duplicate provider records | Freeze funding source and review. |
| Bank succeeds, Solana unavailable | Keep bank-confirmed intent and recover mint; no second bank debit. |
| Mint succeeded but response lost | FundingReceipt proves outcome; same intent cannot mint again. |
| Wallet rejected subscription signature | No subscription token movement; funded wallet balance remains available. |
| RPC submission timeout | Track/retry identical tx; reconcile signature/PDA. |
| Subscription message changed by client | Reject before submission/relayer action. |
| Transaction expired | Read history/PDA, then refresh same logical intent if safely absent. |
| Round closes before subscribe lands | Chain rejects; wallet tokens remain available. |
| Oversubscription | Pro-rata at close; excess goes back to wallet once. |
| Round cancellation | Zero fees/receipts; full token refunds once. |
| Lost indexer event | Backfill/replay without duplicate aggregates. |
| Nessie offline | Funding disabled with clear status; already-funded wallets can still subscribe. |

## 12. Test and verification plan

The reusable [golden cases](fixtures/nessie-purchase-cases.json) specify exact money values, receipt counts, and dust, including oversubscription and zero units. Financial and recovery tests are required before claiming the integration works.

1. **Adapter:** request URL/path/body; key redaction; whole-dollar validation; pending/terminal/unknown status mapping; schema mismatch; bank-history pagination; successful read-back matching; timeout does not retry POST.
2. **Funding DB integration:** same-key replay and conflict, simultaneous requests against account/quota, crash before/after dispatch, lease loss/fencing, generation isolation, account ownership, limits counted across multiple wallets, startup scan recovery.
3. **Funding program:** mint and receipt creation atomic, duplicate same intent/new signature mints zero additional tokens, mismatched wallet/amount/mint fails, unauthorized signer fails, u64 overflow fails.
4. **Subscription:** exact-message validation, forged signatures, team/founder rejection, two-wallet identity race, expiry reservations, atomic payment, duplicate wallet/PDA rejection, changed round state after preparation.
5. **Round program:** documented golden cases, undersubscribed/oversubscribed rounds, integer/dust boundaries, zero units, empty round, cancel before/after finalize, repeat mint/refund, one settlement leg failing, vault conservation.
6. **Indexer:** repeated signatures and multiple events per instruction, provisional drop/finality promotion, restart mid-page, aggregate totals equal canonical finalized events, receipt burn changes balance but not original allocation.
7. **Live smoke test:** with team's key and Devnet deployment, fresh fixture → one bank transfer → guarded funding → signed subscription → finalized allocation → refunds. Record sanitized IDs/status transitions; do not commit keys or synthetic fixture account identifiers as credentials.

Pass criteria include no extra provider writes on app retries, exactly one funded receipt per intent, exact allocation fixtures, and evidence-backed frontend states. Tests requiring credentials or a deployed program remain pending until implementation. This document is not runtime verification.

## 13. Implementation plan, ownership, and rollout

1. **Backend integration owner:** validate Nessie capabilities with sandbox key and record tested profile/version. Done when request/response/status fixtures are sanitized and lifecycle is understood.
2. **Backend owner:** add account mappings, saga/attempt/identity-reservation tables and forward-only migrations. Done when concurrent intent/replay tests pass.
3. **Backend owner:** implement server-only adapter and read-only account/funding status endpoints. Done when no authenticated URL/key escapes and account ownership checks pass.
4. **Chain owner:** add FundingReceipt and guarded `fund_mock_usdc` instruction to the existing Anchor program. Done when crash/replay and wrong-recipient tests pass.
5. **Integration owner:** build durable funding worker and reconciliation; persist before each external write. Done when success, timeout, restart, and uncertain-response cases pass.
6. **Backend + chain owners:** implement subscription preparation, message-bound submission, identity gating, finalization/refunds exactly as current formulas. Done when the golden fixtures and on-chain cases agree.
7. **Frontend owner:** connect account panel, fund-wallet action, commitment preview, progress states, and receipt view using §9. Done when refresh resumes pending work and no provisional units look owned.
8. **Integration owner:** repair indexer event keys/finality and derived metrics; wire completion receipts. Done when replay/backfill reproduces dashboards.
9. **Team:** deploy, run live smoke test, and rehearse happy path plus lost-response recovery or oversubscription. Done when evidence is available for each sponsor action.
10. **Demo owner:** show sponsor-centered banking experience and explain trust boundaries. Done when the entire story fits the judging slot and fallback labels are obvious.

Rollout: forward-only additions; gate new funding off until migration/program/profile checks pass. Pause funding on banking/chain mismatches. Preserve all prior intents and continue reading/reconciling accepted work during a pause. Reset a demo by creating a fresh generation and fixtures, never deleting pending obligations. Close/cancel old rounds and settle outstanding refunds before presenting a fresh demo. Deploy program ID/version and receipt schema explicitly; don't swap IDs while old intents are unresolved.

This design adds recovery states and a guarded funding instruction without changing the valuation algorithm or round fee model. No completed historical allocation is rewritten.

## 14. Nessie prize demonstration and optional features

A convincing sponsor integration makes the banking experience visible:

1. Show the participant's fictional Checking balance and transfer activity from Nessie.
2. Fund $100; show bank processing, transfer reference, and the resulting finalized wallet funding.
3. Commit to a friend's startup round; disclose fee/units and distinguish funding from participation.
4. Close a short demo round; show receipts, startup proceeds, and an excess refund if oversubscribed.
5. Refresh/replay the original request and show one banking transfer and one funding mint.

Next features, after the core works:

- Mock budget view using balances and bills, allowing users to set their own spending reserve before funding. Label it as a sandbox estimate, not proof of real affordability.
- Banking activity timeline tied to wallet funding IDs and startup participation receipts.
- Founder use-of-funds and milestone updates, separate from banking/valuation authority.
- Exportable simulation receipt showing bank funding, on-chain commitment, accepted amount, fee split, allocation, and refund.

Do not add merchants, loans, bills, and purchases just to increase endpoint count. A future founder expense simulator could use merchant purchases, but must have a separately defined fictional bank budget; it cannot double-spend project token proceeds or fabricate a bank payout.

Nessie is a priority for this requested prize path. Do not silently skip it if unavailable. An explicitly selected `FAUCET_ONLY` demo can keep development moving, but it must be visibly labeled and is not evidence of a working Nessie integration. It cannot rescue an uncertain bank write by minting anyway.

## 15. Primary sources and remaining unknowns

- [Current Nessie docs and Quick Start](https://prod.nessieisreal.com/docs): observed through the browser on October 10, 2026; dynamic panels expose authentication, account resources, transfer creation in Quick Start, and the current host selector.
- [Provider Android transfer endpoint contract](https://github.com/nessieisreal/nessie-android-sdk/blob/master/nessie-android-sdk/src/main/java/com/reimaginebanking/api/nessieandroidsdk/requestservices/TransferService.java) and [legacy response fixture](https://github.com/nessieisreal/nessie-android-sdk/blob/master/nessie-android-sdk/src/test/resources/__files/transfer/post-transfer.json): historical wire examples, not a guarantee of the current host's semantics.
- [Solana transaction atomicity](https://solana.com/docs/core/transactions): instructions within a transaction succeed together or revert; transaction fees may still apply.
- [Solana sendTransaction](https://solana.com/docs/rpc/http/sendtransaction): submission does not imply processing/confirmation; signature is available before submission.
- [Solana signature statuses](https://solana.com/docs/rpc/http/getsignaturestatuses): check confirmation/error history alongside program state and blockhash expiry.
- [Token-2022 non-transferable receipts](https://solana.com/docs/tokens/extensions/non-transferrable-tokens): enforce receipt transfer restrictions in the program/token standard.

Unverified until the team runs the capability gate: live banking credentials, provider status transitions/delays, balance effects, response envelope, transfer-history pagination/consistency, deployment rate limits, and current sandbox reachability from the team's hosting provider. Do not invent these properties in code. Remaining implementation work is explicitly assigned in §13.
