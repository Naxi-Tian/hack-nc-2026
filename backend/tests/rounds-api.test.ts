// Wallet binding, round drafting at the chain boundary, and next-round demand (M§7.2–7.3, §4.9),
// against the real 0001/0002 DDL in PGlite.
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createProjectsRouter } from "../src/routes/projects.js";
import { createRoundsRouter } from "../src/routes/rounds.js";
import { createWalletsRouter } from "../src/routes/wallets.js";
import { recordRoundOpened, type RoundOpenedEvent } from "../src/rounds/service.js";
import { allocate } from "../src/settlement/math.js";
import { modelHash } from "../src/valuation/model-value.js";
import { modelDocument } from "../src/valuation/service.js";
import { base58Decode, base58Encode, verifyWalletSignature } from "../src/wallets/solana.js";
import { asPool, coreSchemaSql } from "./helpers/pglite-schema.js";

const ORIGIN = "http://localhost:8787";
let db: PGlite;
let pool: Pool;
let allowDraftModel = false;
let app: Hono;

const deny = (status: 401 | 404, code: string) => new HTTPException(status, { res: Response.json({ error: { code } }, { status }) });
const requireIdentity = async (context: Context) => {
  const identityId = context.req.header("x-test-identity");
  if (!identityId) throw deny(401, "UNAUTHENTICATED");
  return { identityId };
};
const requireProjectEditor = async (context: Context, projectId: string) => {
  const { identityId } = await requireIdentity(context);
  const { rowCount } = await pool.query(
    `select 1 from projects p where p.id = $1 and (p.founder_identity_id = $2
       or exists (select 1 from project_members m where m.project_id = p.id and m.identity_id = $2))`,
    [projectId, identityId],
  );
  if (!rowCount) throw deny(404, "PROJECT_NOT_FOUND");
  return { identityId };
};

let emails = 0;
async function newIdentity(): Promise<string> {
  const email = `user${++emails}@unc.edu`;
  const user = await db.query<{ id: string }>(
    `insert into auth."user" (name, email, "emailVerified", "createdAt", "updatedAt") values ('', $1, true, now(), now()) returning id`,
    [email],
  );
  const identity = await db.query<{ id: string }>(
    `insert into identities (auth_user_id, campus_email_hash, verification_status, verified_at) values ($1, $2, 'VERIFIED', now()) returning id`,
    [user.rows[0].id, createHash("sha256").update(email).digest("hex")],
  );
  return identity.rows[0].id;
}

const call = (identity: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(`/api${path}`, {
    method,
    headers: { "content-type": "application/json", origin: ORIGIN, ...(identity ? { "x-test-identity": identity } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

function newWallet(): { address: string; privateKey: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  return { address: base58Encode(raw), privateKey };
}

async function bindWallet(identity: string, wallet = newWallet()) {
  const challenge = await (await call(identity, "POST", "/wallets/challenge", { address: wallet.address })).json();
  const signature = base58Encode(sign(null, Buffer.from(challenge.message, "utf8"), wallet.privateKey));
  return { wallet, response: await call(identity, "POST", "/wallets/verify", { address: wallet.address, signature }), signature };
}

let keys = 0;
async function publishedProject(founder: string, name: string) {
  const created = await (
    await call(founder, "POST", "/projects", { name, stage: "LAUNCHED", founder: { display_name: "Ana Ruiz" } }, { "idempotency-key": `proj-${++keys}-key` })
  ).json();
  await call(founder, "POST", `/projects/${created.project.id}/publish`);
  return created.project.id as string;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(coreSchemaSql());
  pool = asPool(db);
  const seed = JSON.parse(readFileSync(new URL("../../db/seeds/valuation-v0.1.json", import.meta.url), "utf8"));
  await db.query(
    `insert into model_versions (id, effective_at, stage_weights, factor_weights, normalization_rules, scenario_parameters, demand_parameters, model_hash)
     values ($1, now(), $2, $3, $4, $5, $6, $7)`,
    [seed.id, ...["stage_weights", "factor_weights", "normalization_rules", "scenario_parameters", "demand_parameters"].map((k) => JSON.stringify(seed[k])), modelHash(modelDocument(seed))],
  );
  const guards = { pool, publicOrigin: ORIGIN, requireIdentity };
  app = new Hono();
  app.route("/api", createProjectsRouter({ ...guards, requireProjectEditor }));
  app.route("/api", createWalletsRouter(guards));
  // A getter, so each test can flip allowDraftModel (the router reads it per request).
  app.route(
    "/api",
    createRoundsRouter({
      ...guards,
      requireProjectEditor,
      programId: null,
      get allowDraftModel() {
        return allowDraftModel;
      },
    }),
  );
  app.onError((error, context) => (error instanceof HTTPException ? error.getResponse() : context.json({ error: { code: "INTERNAL", message: String(error) } }, 500)));
});

afterAll(async () => {
  await db.close();
});

describe("Solana wallet primitives", () => {
  it("round-trips base58 with leading zeros and rejects bad input", () => {
    const bytes = Uint8Array.from([0, 0, 1, 2, 255]);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
    expect(base58Decode("0OIl")).toBeNull();
    // The System Program id is 32 zero bytes.
    expect(base58Decode("11111111111111111111111111111111")).toEqual(new Uint8Array(32));
  });

  it("verifies only the exact message signed by the address's key", () => {
    const wallet = newWallet();
    const signature = base58Encode(sign(null, Buffer.from("hello"), wallet.privateKey));
    expect(verifyWalletSignature(wallet.address, "hello", signature)).toBe(true);
    expect(verifyWalletSignature(wallet.address, "hello!", signature)).toBe(false);
    expect(verifyWalletSignature(newWallet().address, "hello", signature)).toBe(false);
  });
});

describe("wallet binding", () => {
  it("binds the first wallet as primary, burns the nonce, and keeps a wallet on one identity", async () => {
    const ana = await newIdentity();
    const { wallet, response, signature } = await bindWallet(ana);
    expect(response.status).toBe(200);
    expect((await response.json()).wallet).toEqual({ address: wallet.address, isPrimary: true });

    // Same signature again: the nonce is spent.
    expect((await call(ana, "POST", "/wallets/verify", { address: wallet.address, signature })).status).toBe(409);
    // Another identity cannot take the wallet, even with a valid signature.
    const ben = await newIdentity();
    const stolen = await bindWallet(ben, wallet);
    expect((await stolen.response.json()).error.code).toBe("WALLET_TAKEN");
    // A wrong signature fails.
    const other = newWallet();
    await call(ana, "POST", "/wallets/challenge", { address: other.address });
    const forged = base58Encode(sign(null, Buffer.from("not the challenge"), other.privateKey));
    expect((await (await call(ana, "POST", "/wallets/verify", { address: other.address, signature: forged })).json()).error.code).toBe("WALLET_NOT_VERIFIED");
  });

  it("caps an identity at two active wallets", async () => {
    const cy = await newIdentity();
    expect((await bindWallet(cy)).response.status).toBe(200);
    const second = await (await bindWallet(cy)).response.json();
    expect(second.wallet.isPrimary).toBe(false);
    expect((await (await bindWallet(cy)).response.json()).error.code).toBe("WALLET_LIMIT");
  });

  it("rejects malformed addresses and foreign origins", async () => {
    const dee = await newIdentity();
    expect((await call(dee, "POST", "/wallets/challenge", { address: "not-a-wallet" })).status).toBe(400);
    expect((await call(dee, "POST", "/wallets/challenge", { address: newWallet().address }, { origin: "https://evil.example" })).status).toBe(403);
  });
});

describe("rounds at the chain boundary", () => {
  it("drafts a round from the frozen snapshot, then opens it only when on-chain terms match", async () => {
    const founder = await newIdentity();
    const projectId = await publishedProject(founder, "Mothlight");
    const open = (body: unknown = {}, key = `round-${++keys}-key`, who = founder) => call(who, "POST", `/projects/${projectId}/rounds`, body, { "idempotency-key": key });

    expect((await (await open()).json()).error.code).toBe("WALLET_NOT_VERIFIED");
    const { wallet } = await bindWallet(founder);
    allowDraftModel = false;
    expect((await (await open()).json()).error.code).toBe("MODEL_NOT_ACTIVE");
    allowDraftModel = true;
    expect((await open({ max_units: "200001" })).status).toBe(400);

    const teammate = await newIdentity();
    await db.query(`insert into project_members (project_id, identity_id, role) values ($1, $2, 'TEAM')`, [projectId, teammate]);
    expect((await (await open({}, "team-key-1", teammate)).json()).error.code).toBe("FORBIDDEN");

    const created = await open({ max_units: "100000", duration_days: 7 }, "round-main-1");
    expect(created.status).toBe(201);
    const draft = await created.json();
    const price = BigInt(draft.valuation.values.unitPriceMicroUsd);
    expect(draft.round).toMatchObject({ status: "DRAFT", roundNumber: 1, maxUnits: "100000", unitPriceMicroUsd: String(price), simulation: true });
    expect(BigInt(draft.round.targetMicroUsd)).toBe(price * 100_000n);
    expect(BigInt(draft.round.maxSubscriptionMicroUsd)).toBe((price * 100_000n * 1000n) / 10_000n);
    expect(Date.parse(draft.round.closesAt) - Date.parse(draft.round.opensAt)).toBe(7 * 86_400_000);
    expect(draft.chain).toMatchObject({ programId: null, status: "AWAITING_PROGRAM", founderWallet: wallet.address });
    expect(draft.chain.instructions.map((i: { name: string }) => i.name)).toEqual(["create_project", "open_round"]);
    const args = draft.chain.instructions[1].args;
    expect(args).toMatchObject({ round_number: "1", unit_price_micro_usd: String(price), max_units: "100000", target_amount: draft.round.targetMicroUsd });
    expect(args.model_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(draft.chain.seeds.round[2]).toBe("0x0100");
    expect((await db.query(`select founder_wallet from projects where id = $1`, [projectId])).rows[0]).toEqual({ founder_wallet: wallet.address });

    // Same key replays; a new key cannot open a second round.
    expect(await (await open({ max_units: "100000", duration_days: 7 }, "round-main-1")).json()).toEqual(draft);
    expect((await (await open({}, "round-other-1")).json()).error.code).toBe("ROUND_EXISTS");

    // Drafts are private.
    expect((await call(null, "GET", `/rounds/${draft.round.id}`)).status).toBe(404);
    expect((await call(founder, "GET", `/rounds/${draft.round.id}`)).status).toBe(200);

    // The indexer confirms RoundOpened; any differing term is refused and the round stays DRAFT.
    const event: RoundOpenedEvent = {
      roundPda: newWallet().address,
      projectPda: newWallet().address,
      receiptMint: newWallet().address,
      roundNumber: 1,
      opensAt: args.opens_at,
      closesAt: args.closes_at,
      unitPriceMicroUsd: args.unit_price_micro_usd,
      maxUnits: args.max_units,
      targetAmount: args.target_amount,
      maxSubscriptionAmount: args.max_subscription_amount,
      modelHash: args.model_hash,
      evidenceRoot: args.evidence_root,
    };
    await expect(recordRoundOpened(pool, draft.round.id, { ...event, unitPriceMicroUsd: String(price + 1n) })).rejects.toMatchObject({ code: "CHAIN_TERMS_MISMATCH" });
    expect((await db.query(`select status::text from rounds where id = $1`, [draft.round.id])).rows[0]).toEqual({ status: "DRAFT" });
    expect(await recordRoundOpened(pool, draft.round.id, event)).toBe("OPEN");
    expect(await recordRoundOpened(pool, draft.round.id, event)).toBe("OPEN"); // replay
    expect((await db.query(`select solana_project_pda, receipt_mint from projects where id = $1`, [projectId])).rows[0]).toEqual({
      solana_project_pda: event.projectPda,
      receipt_mint: event.receiptMint,
    });

    // Public view explains the price; the profile shows the round; terms are frozen in the database.
    const pub = await (await call(null, "GET", `/rounds/${draft.round.id}`)).json();
    expect(pub.round).toMatchObject({ status: "OPEN", phase: "OPEN", solanaRoundPda: event.roundPda, committedBps: "0" });
    expect(pub.valuation).toMatchObject({ effective_stage: "IDEA", round_implied_value: expect.any(String) });
    const slug = (await db.query<{ slug: string }>(`select slug from projects where id = $1`, [projectId])).rows[0].slug;
    expect((await (await call(null, "GET", `/projects/${slug}`)).json()).project.round).toMatchObject({ id: draft.round.id, status: "OPEN" });
    await expect(db.query(`update rounds set unit_price_micro_usd = unit_price_micro_usd + 1 where id = $1`, [draft.round.id])).rejects.toThrow(/frozen/);
    expect((await call(founder, "DELETE", `/rounds/${draft.round.id}`)).status).toBe(404);

    // Quotes use the settlement math and the per-person cap.
    const quote = await (await call(null, "GET", `/rounds/${draft.round.id}/quote?gross_micro_usd=100000000`)).json();
    const expected = allocate({ unitPriceMicroUsd: price, maxUnits: 100_000n, targetMicroUsd: price * 100_000n, protocolFeeBps: 100n, founderFeeShareBps: 4000n }, 100_000_000n, 100_000_000n);
    expect(quote.quote).toMatchObject({ units: String(expected.units), feeMicroUsd: "1000000", proRataReduced: false, estimate: true });
    expect((await call(null, "GET", `/rounds/${draft.round.id}/quote?gross_micro_usd=1`)).status).toBe(400);
  });

  it("lets the founder withdraw a draft round", async () => {
    const founder = await newIdentity();
    const projectId = await publishedProject(founder, "Dormfold");
    await bindWallet(founder);
    allowDraftModel = true;
    const draft = await (await call(founder, "POST", `/projects/${projectId}/rounds`, {}, { "idempotency-key": "dorm-round-1" })).json();
    expect((await call(await newIdentity(), "DELETE", `/rounds/${draft.round.id}`)).status).toBe(404);
    expect((await call(founder, "DELETE", `/rounds/${draft.round.id}`)).status).toBe(204);
    expect((await call(founder, "POST", `/projects/${projectId}/rounds`, {}, { "idempotency-key": "dorm-round-2" })).status).toBe(201);
  });

  it("prices the next round with the finalized round's demand, excluding the founder", async () => {
    const founder = await newIdentity();
    const projectId = await publishedProject(founder, "Quillnote");
    const { wallet } = await bindWallet(founder);
    allowDraftModel = true;
    const draft = await (await call(founder, "POST", `/projects/${projectId}/rounds`, { max_units: "1000" }, { "idempotency-key": "quil-round-1" })).json();
    const roundId = draft.round.id;
    const target = BigInt(draft.round.targetMicroUsd);

    // Settled round: 4 eligible buyers took the whole target in equal shares; the founder's own
    // subscription (only possible off-chain here) must not count.
    const buyers = await Promise.all([1, 2, 3, 4].map(async () => ({ identity: await newIdentity(), wallet: newWallet().address })));
    for (const buyer of buyers) {
      await db.query(`insert into wallets (address, identity_id, verified_signature, is_primary) values ($1, $2, 'sig', true)`, [buyer.wallet, buyer.identity]);
      await db.query(
        `insert into subscriptions (round_id, identity_id, wallet_address, requested_amount_micro_usd, accepted_amount_micro_usd, status)
         values ($1, $2, $3, $4, $4, 'FINALIZED')`,
        [roundId, buyer.identity, buyer.wallet, String(target / 4n)],
      );
    }
    await db.query(
      `insert into subscriptions (round_id, identity_id, wallet_address, requested_amount_micro_usd, accepted_amount_micro_usd, status)
       values ($1, $2, $3, $4, $4, 'FINALIZED')`,
      [roundId, founder, wallet.address, String(target)],
    );
    await db.query(`update rounds set status = 'FINALIZED' where id = $1`, [roundId]);

    const next = await (await call(founder, "POST", `/projects/${projectId}/valuation/preview`)).json();
    // fill 1.0, breadth 4/10, equal shares → D = 0.55 + 0.12 + 0.15 = 0.82; multiplier exp(0.4 × 0.32).
    expect(next.explanationInputs.priorRound).toMatchObject({ round_id: roundId, eligible_buyers: 4, accepted_micro_usd: String(target) });
    expect(next.explanationInputs.demand.score).toBeCloseTo(0.82, 12);
    expect(next.values.demandMultiplier).toBeCloseTo(Math.exp(0.4 * 0.32), 12);
    const snapshot = await db.query(`select prior_round_id from valuation_snapshots where id = $1`, [next.snapshot.id]);
    expect(snapshot.rows[0]).toEqual({ prior_round_id: roundId });
  });
});
