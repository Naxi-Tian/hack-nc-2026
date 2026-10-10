-- migrate:up
-- Prospecto schema: market core (MARKET ARCHITECTURE §8), Better Auth, the Nessie funding saga
-- (NESSIE_PURCHASE_FLOW §5), dashboard aggregates, and the runtime role.
-- All money is BIGINT micro-USD (mock USDC has 6 decimals); model outputs stay NUMERIC.
-- Users see formatted dollars; the integer micro-USD value is what is stored and settled.
create extension if not exists timescaledb;

create type identity_status as enum ('ACTIVE', 'SUSPENDED');
create type identity_verification_status as enum ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');
create type platform_role as enum ('USER', 'REVIEWER', 'ADMIN');
create type project_stage as enum ('IDEA', 'PROTOTYPE', 'LAUNCHED', 'EARLY_REVENUE', 'REPEATABLE_REVENUE');
create type project_status as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED');
create type entity_type as enum ('UNINCORPORATED', 'INCORPORATED');
create type profile_snapshot_source as enum ('PASTED_TEXT', 'DATA_EXPORT');
create type project_member_role as enum ('FOUNDER', 'TEAM');
create type evidence_source_type as enum ('FOUNDER_STATEMENT', 'DOCUMENT', 'LINK', 'INTEGRATION');
-- Evidence levels from §4.5. The confidence multiplier for each level is a model parameter
-- (model_versions.normalization_rules), so it is not stored here.
create type evidence_status as enum (
  'INDEPENDENTLY_VERIFIED', 'REVIEWER_VERIFIED', 'PUBLIC_WEAK', 'FOUNDER_ATTESTED', 'MISSING_OR_CONTRADICTED'
);
create type model_version_status as enum ('DRAFT', 'ACTIVE', 'RETIRED');
create type round_status as enum (
  'DRAFT', 'SCHEDULED', 'OPEN', 'FILLED', 'EXPIRED', 'FINALIZED', 'REFUNDING', 'CANCELLED'
);
create type subscription_status as enum ('PREPARED', 'SUBMITTED', 'CONFIRMED', 'FINALIZED', 'FAILED', 'REFUNDED');

-- Shared guard for immutable history: corrections append new rows instead.
-- Hypertable triggers pass the table name, since tg_table_name is the internal chunk there.
create function reject_append_only_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only; % is not allowed', coalesce(tg_argv[0], tg_table_name), tg_op
    using errcode = 'restrict_violation';
end;
$$;

-- Better Auth -----------------------------------------------------------------
-- better-auth 1.7.7, emailOTP plugin (campus email codes), advanced.database.generateId = "uuid".
-- Columns mirror getAuthTables() for that configuration; Better Auth queries them by these exact
-- camelCase names. On a Better Auth upgrade, re-run `npx auth@<version> generate` and add a new
-- migration for any diff. The app reaches this schema only through Better Auth
-- (pool with search_path=auth); public API responses never read it directly.
create schema if not exists auth;

create table auth."user" (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  "emailVerified" boolean not null,
  image text,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);

create table auth.session (
  id uuid primary key default gen_random_uuid(),
  "expiresAt" timestamptz not null,
  token text not null unique,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" uuid not null references auth."user"(id) on delete cascade
);
create index session_user_id_idx on auth.session("userId");

create table auth.account (
  id uuid primary key default gen_random_uuid(),
  "accountId" text not null,
  "providerId" text not null,
  "userId" uuid not null references auth."user"(id) on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);
create index account_user_id_idx on auth.account("userId");

-- Email OTPs live here; emailOTP is configured with storeOTP: "hashed".
create table auth.verification (
  id uuid primary key default gen_random_uuid(),
  identifier text not null,
  value text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null,
  "updatedAt" timestamptz not null
);
create index verification_identifier_idx on auth.verification(identifier);

-- Identity and wallets --------------------------------------------------------

-- Created lazily on the first authenticated request after the campus email is verified
-- (Better Auth after-hooks run post-commit and can be lost).
create table identities (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth."user"(id) on delete restrict,
  -- Keyed HMAC-SHA256 of the normalized campus email; the raw address stays in auth."user".
  campus_email_hash text not null unique check (campus_email_hash ~ '^[a-f0-9]{64}$'),
  status identity_status not null default 'ACTIVE',
  verification_status identity_verification_status not null default 'NOT_STARTED',
  verified_at timestamptz,
  platform_role platform_role not null default 'USER',
  risk_flags jsonb not null default '[]'::jsonb check (jsonb_typeof(risk_flags) = 'array'),
  created_at timestamptz not null default now(),
  check ((verification_status = 'VERIFIED') = (verified_at is not null))
);

create table wallets (
  address text primary key,
  identity_id uuid not null references identities(id),
  chain text not null default 'solana' check (chain = 'solana'),
  verified_signature text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index wallets_identity_idx on wallets(identity_id);
create unique index wallets_one_active_primary_per_identity
  on wallets(identity_id) where is_primary and revoked_at is null;

-- §10.1: an identity binds at most 2 active wallets (BACKEND_STACK §7), and a wallet never moves
-- to another identity, so changing wallets cannot create a new eligible identity.
create function guard_wallet_binding() returns trigger
language plpgsql as $$
declare
  active_wallets integer;
begin
  if tg_op = 'UPDATE' and (new.address, new.identity_id) is distinct from (old.address, old.identity_id) then
    raise exception 'wallet % cannot be re-bound', old.address using errcode = 'restrict_violation';
  end if;

  if new.revoked_at is null and (tg_op = 'INSERT' or old.revoked_at is not null) then
    -- Lock the identity so concurrent bindings cannot both pass the count.
    perform 1 from identities where id = new.identity_id for update;
    select count(*) into active_wallets
      from wallets
     where identity_id = new.identity_id and revoked_at is null and address <> new.address;
    if active_wallets >= 2 then
      raise exception 'identity % already has 2 active wallets; revoke one first', new.identity_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger wallets_guard_binding
  before insert or update on wallets
  for each row execute function guard_wallet_binding();

-- Single-use, expiring wallet-binding challenges (§12). Consume with
-- UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() RETURNING.
create table wallet_challenges (
  nonce text primary key check (length(nonce) >= 32),
  wallet_address text not null,
  identity_id uuid references identities(id),
  message text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  check (expires_at > created_at)
);

-- Projects and evidence ---------------------------------------------------

create table sectors (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  name text not null
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (length(name) between 1 and 120),
  description text not null default '',
  -- The founder's one-liner: shown on listings and given to research as search context (never cited or scored).
  tagline text not null default '' check (length(tagline) <= 140),
  website_url text check (website_url ~ '^https?://' and length(website_url) <= 2048),
  entity_type entity_type not null default 'UNINCORPORATED',
  -- Incorporated only: lets research confirm the entity in the state registry and match pages on the legal name.
  legal_name text check (length(legal_name) between 1 and 200),
  formation_state text check (formation_state ~ '^[A-Z]{2}$'),
  -- Listings publish the founder's campus email (auth."user".email); the founder can turn this off.
  publish_contact_email boolean not null default true,
  sector_code text references sectors(code),
  -- Declared by the founder. Valuation prices on the lower of this and the evidence-supported stage.
  stage project_stage not null,
  status project_status not null default 'DRAFT',
  founder_identity_id uuid not null references identities(id),
  founder_wallet text references wallets(address),
  solana_project_pda text unique,
  receipt_mint text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (entity_type = 'INCORPORATED' or (legal_name is null and formation_state is null))
);

create table project_members (
  project_id uuid not null references projects(id),
  identity_id uuid not null references identities(id),
  role project_member_role not null,
  -- Listing display only. Names and titles carry zero weight in scoring (§2.3).
  display_name text check (length(display_name) between 1 and 120),
  role_title text check (length(role_title) between 1 and 80),
  joined_at timestamptz not null default now(),
  primary key (project_id, identity_id)
);

-- Founder-provided LinkedIn profile text (§6.5); LinkedIn is never scraped. Claims from it are
-- founder-attested unless a third-party page corroborates them. Deleting erases the text but
-- keeps the row, so research runs that used it stay explainable.
create table profile_snapshots (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references identities(id),
  -- Canonical https://www.linkedin.com/in/<handle> form, written by the API.
  profile_url text not null check (profile_url ~ '^https://www\.linkedin\.com/in/[^/?#]+$'),
  source profile_snapshot_source not null,
  text text check (length(text) between 1 and 20000),
  content_hash text check (content_hash ~ '^[a-f0-9]{64}$'),
  captured_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((deleted_at is null) = (text is not null and content_hash is not null))
);

create unique index profile_snapshots_one_live
  on profile_snapshots(identity_id, profile_url) where deleted_at is null;

-- Cached Gemini proposals. Advisory only; never authoritative (§3.2).
create table ai_intake_proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  created_by_identity_id uuid not null references identities(id),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  prompt_version text not null,
  model text not null,
  proposal jsonb not null check (jsonb_typeof(proposal) = 'object'),
  created_at timestamptz not null default now(),
  unique (project_id, content_hash, prompt_version)
);

-- Claims are immutable; a correction is a new row that supersedes exactly one prior claim.
create table evidence_claims (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  metric_code text not null check (length(metric_code) between 1 and 80),
  -- What the claim is about when it is not this project, e.g. the prior venture a
  -- prior_venture_* claim describes. Null means the project itself.
  subject text check (length(subject) between 1 and 200),
  value_numeric numeric(30, 8),
  value_text text,
  unit text,
  period_start date,
  period_end date,
  source_type evidence_source_type not null,
  source_uri text,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  ai_intake_proposal_id uuid references ai_intake_proposals(id),
  created_by_identity_id uuid not null references identities(id),
  supersedes_claim_id uuid unique references evidence_claims(id),
  created_at timestamptz not null default now(),
  check (period_end is null or period_start is null or period_end >= period_start),
  check (value_numeric is not null or value_text is not null),
  check (supersedes_claim_id is distinct from id)
);

create index evidence_claims_project_created_idx on evidence_claims(project_id, created_at desc);

create trigger evidence_claims_append_only
  before update or delete on evidence_claims
  for each row execute function reject_append_only_mutation();

-- Append-only verification history; the latest row per claim is its current status.
-- Who may verify (reviewer role, not a project member) is enforced by the API.
create table evidence_verifications (
  id bigint generated always as identity primary key,
  claim_id uuid not null references evidence_claims(id),
  status evidence_status not null,
  verified_by_identity_id uuid references identities(id),
  note text,
  created_at timestamptz not null default now(),
  check (status <> 'REVIEWER_VERIFIED' or verified_by_identity_id is not null)
);

create index evidence_verifications_claim_idx on evidence_verifications(claim_id, id desc);

create trigger evidence_verifications_append_only
  before update or delete on evidence_verifications
  for each row execute function reject_append_only_mutation();

create view evidence_claim_current_status as
select distinct on (claim_id) claim_id, status, verified_by_identity_id, created_at as status_at
  from evidence_verifications
 order by claim_id, id desc;

-- Model and valuation -----------------------------------------------------

create table model_versions (
  id text primary key,
  effective_at timestamptz not null,
  stage_weights jsonb not null,
  factor_weights jsonb not null,
  normalization_rules jsonb not null,
  scenario_parameters jsonb not null,
  demand_parameters jsonb not null,
  code_commit text,
  model_hash text check (model_hash ~ '^[a-f0-9]{64}$'),
  status model_version_status not null default 'DRAFT',
  check (status = 'DRAFT' or model_hash is not null)
);

create unique index model_versions_one_active on model_versions((true)) where status = 'ACTIVE';

-- Once a version leaves DRAFT its parameters are frozen; a weight change needs a new version.
create function guard_model_version_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then
      raise exception 'model version % is not a draft and cannot be deleted', old.id
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if old.status <> 'DRAFT' and (
       new.id, new.effective_at, new.stage_weights, new.factor_weights, new.normalization_rules,
       new.scenario_parameters, new.demand_parameters, new.code_commit, new.model_hash
     ) is distinct from (
       old.id, old.effective_at, old.stage_weights, old.factor_weights, old.normalization_rules,
       old.scenario_parameters, old.demand_parameters, old.code_commit, old.model_hash
     ) then
    raise exception 'model version % is frozen', old.id using errcode = 'restrict_violation';
  end if;

  if new.status <> old.status and not (
       (old.status = 'DRAFT' and new.status in ('ACTIVE', 'RETIRED'))
       or (old.status = 'ACTIVE' and new.status = 'RETIRED')
     ) then
    raise exception 'invalid model version transition % -> %', old.status, new.status
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger model_versions_guard
  before update or delete on model_versions
  for each row execute function guard_model_version_mutation();

-- score_snapshots and valuation_snapshots from one valuation run share valuation_run_id.
-- (TimescaleDB does not support foreign keys between two hypertables.)
create table score_snapshots (
  calculated_at timestamptz not null default now(),
  valuation_run_id uuid not null,
  project_id uuid not null references projects(id),
  model_version_id text not null references model_versions(id),
  -- Stage whose weights were applied: min(declared, evidence-supported).
  effective_stage project_stage not null,
  execution_score numeric(8, 7) not null check (execution_score between 0 and 1),
  market_score numeric(8, 7) not null check (market_score between 0 and 1),
  product_score numeric(8, 7) not null check (product_score between 0 and 1),
  traction_score numeric(8, 7) not null check (traction_score between 0 and 1),
  economics_score numeric(8, 7) not null check (economics_score between 0 and 1),
  composite_score numeric(8, 7) not null check (composite_score between 0 and 1),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  factor_contributions jsonb not null,
  unique (calculated_at, valuation_run_id)
) with (
  tsdb.hypertable,
  tsdb.partition_column = 'calculated_at',
  tsdb.segmentby = 'project_id',
  tsdb.orderby = 'calculated_at desc'
);

create trigger score_snapshots_append_only
  before update or delete on score_snapshots
  for each row execute function reject_append_only_mutation('score_snapshots');

create table valuation_snapshots (
  id uuid not null default gen_random_uuid(),
  calculated_at timestamptz not null default now(),
  valuation_run_id uuid not null,
  project_id uuid not null references projects(id),
  model_version_id text not null references model_versions(id),
  model_hash text not null check (model_hash ~ '^[a-f0-9]{64}$'),
  -- Scenario priors use effective_stage, which never exceeds the founder's declared stage.
  declared_stage project_stage not null,
  effective_stage project_stage not null check (effective_stage <= declared_stage),
  prior_round_id uuid,
  current_operating_value numeric(30, 8) not null check (current_operating_value >= 0),
  scenario_value numeric(30, 8) not null check (scenario_value >= 0),
  model_reference_value numeric(30, 8) not null check (model_reference_value >= 0),
  demand_score numeric(8, 7) check (demand_score between 0 and 1),
  demand_multiplier numeric(12, 8) check (demand_multiplier > 0),
  round_implied_value numeric(30, 8) check (round_implied_value >= 0),
  reference_units bigint not null default 1000000 check (reference_units > 0),
  unit_price_micro_usd bigint check (unit_price_micro_usd > 0),
  scenario_details jsonb not null,
  assumptions jsonb not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  evidence_root text check (evidence_root ~ '^[a-f0-9]{64}$'),
  -- Hypertable unique keys must include the partition column.
  primary key (id, calculated_at),
  unique (calculated_at, valuation_run_id),
  -- §4.10 unit price, rounded down to whole micro-USD: floor(value × 10^6 / reference_units).
  check ((round_implied_value is null) = (unit_price_micro_usd is null)),
  check (unit_price_micro_usd = floor(round_implied_value * 1000000 / reference_units))
) with (
  tsdb.hypertable,
  tsdb.partition_column = 'calculated_at',
  tsdb.segmentby = 'project_id',
  tsdb.orderby = 'calculated_at desc'
);

create trigger valuation_snapshots_append_only
  before update or delete on valuation_snapshots
  for each row execute function reject_append_only_mutation('valuation_snapshots');

-- Traction points derived from evidence claims; readers exclude superseded claims.
create table traction_metrics (
  observed_at timestamptz not null,
  project_id uuid not null references projects(id),
  metric_code text not null,
  value numeric(30, 8) not null,
  unit text not null,
  evidence_claim_id uuid not null references evidence_claims(id),
  primary key (observed_at, project_id, metric_code, evidence_claim_id)
) with (
  tsdb.hypertable,
  tsdb.partition_column = 'observed_at',
  tsdb.segmentby = 'project_id',
  tsdb.orderby = 'observed_at desc'
);

create trigger traction_metrics_append_only
  before update or delete on traction_metrics
  for each row execute function reject_append_only_mutation('traction_metrics');

-- Rounds and settlement mirrors (Solana is authoritative) -----------------

create table rounds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  round_number integer not null check (round_number > 0),
  solana_round_pda text unique,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  unit_price_micro_usd bigint not null check (unit_price_micro_usd > 0),
  max_units bigint not null check (max_units > 0),
  target_amount_micro_usd bigint not null check (target_amount_micro_usd > 0),
  protocol_fee_bps integer not null default 100 check (protocol_fee_bps between 0 and 10000),
  founder_fee_share_bps integer not null default 4000 check (founder_fee_share_bps between 0 and 10000),
  model_version_id text not null references model_versions(id),
  valuation_snapshot_id uuid not null,
  valuation_calculated_at timestamptz not null,
  model_hash text not null check (model_hash ~ '^[a-f0-9]{64}$'),
  evidence_root text not null check (evidence_root ~ '^[a-f0-9]{64}$'),
  total_committed_micro_usd bigint not null default 0 check (total_committed_micro_usd >= 0),
  status round_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, round_number),
  foreign key (valuation_snapshot_id, valuation_calculated_at)
    references valuation_snapshots(id, calculated_at),
  check (closes_at > opens_at),
  -- Units are floor((accepted - fee) / price) and accepted <= target, so this keeps
  -- total allocation within max_units.
  check (target_amount_micro_usd::numeric <= max_units::numeric * unit_price_micro_usd)
);

create unique index rounds_one_active_per_project
  on rounds(project_id) where status not in ('DRAFT', 'FINALIZED', 'CANCELLED');

alter table valuation_snapshots
  add constraint valuation_snapshots_prior_round_fk foreign key (prior_round_id) references rounds(id);

-- §10.3: published round terms never change, and they must match the valuation snapshot
-- they cite, so "why is this the price?" always resolves to one snapshot.
create function guard_round_terms() returns trigger
language plpgsql as $$
declare
  snapshot valuation_snapshots%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'DRAFT' then
      raise exception 'round % is not a draft and cannot be deleted', old.id
        using errcode = 'restrict_violation';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'DRAFT' and (
       new.project_id, new.round_number, new.opens_at, new.closes_at, new.unit_price_micro_usd,
       new.max_units, new.target_amount_micro_usd, new.protocol_fee_bps, new.founder_fee_share_bps,
       new.model_version_id, new.valuation_snapshot_id, new.valuation_calculated_at,
       new.model_hash, new.evidence_root
     ) is distinct from (
       old.project_id, old.round_number, old.opens_at, old.closes_at, old.unit_price_micro_usd,
       old.max_units, old.target_amount_micro_usd, old.protocol_fee_bps, old.founder_fee_share_bps,
       old.model_version_id, old.valuation_snapshot_id, old.valuation_calculated_at,
       old.model_hash, old.evidence_root
     ) then
    raise exception 'round % terms are frozen once it leaves DRAFT', old.id
      using errcode = 'restrict_violation';
  end if;

  select * into snapshot
    from valuation_snapshots
   where id = new.valuation_snapshot_id and calculated_at = new.valuation_calculated_at;

  if snapshot.project_id is distinct from new.project_id
     or snapshot.model_version_id is distinct from new.model_version_id
     or snapshot.model_hash is distinct from new.model_hash
     or snapshot.evidence_root is distinct from new.evidence_root
     or snapshot.unit_price_micro_usd is distinct from new.unit_price_micro_usd then
    raise exception 'round terms do not match valuation snapshot %', new.valuation_snapshot_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger rounds_guard_terms
  before insert or update or delete on rounds
  for each row execute function guard_round_terms();

-- Mirror of Subscription PDAs. Fee and unit arithmetic (§4.10–4.12, rounded down):
--   protocol_fee = floor(accepted × protocol_fee_bps / 10000)
--   founder_reward = floor(protocol_fee × founder_fee_share_bps / 10000)
--   allocated_units = floor((accepted − protocol_fee) / unit_price); sub-unit dust stays in proceeds.
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id),
  identity_id uuid not null references identities(id),
  wallet_address text not null references wallets(address),
  subscription_pda text unique,
  requested_amount_micro_usd bigint not null check (requested_amount_micro_usd > 0),
  accepted_amount_micro_usd bigint not null default 0 check (accepted_amount_micro_usd >= 0),
  protocol_fee_micro_usd bigint not null default 0 check (protocol_fee_micro_usd >= 0),
  founder_reward_micro_usd bigint not null default 0 check (founder_reward_micro_usd >= 0),
  refunded_amount_micro_usd bigint not null default 0 check (refunded_amount_micro_usd >= 0),
  allocated_units bigint not null default 0 check (allocated_units >= 0),
  status subscription_status not null default 'PREPARED',
  solana_signature text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (round_id, identity_id),
  unique (round_id, wallet_address),
  check (accepted_amount_micro_usd <= requested_amount_micro_usd),
  check (protocol_fee_micro_usd <= accepted_amount_micro_usd),
  check (founder_reward_micro_usd <= protocol_fee_micro_usd),
  check (refunded_amount_micro_usd <= requested_amount_micro_usd - accepted_amount_micro_usd)
);

create table chain_events (
  id uuid primary key default gen_random_uuid(),
  chain text not null default 'solana' check (chain = 'solana'),
  program_id text not null,
  signature text not null,
  instruction_index integer not null check (instruction_index >= 0),
  -- One instruction can emit several events (NESSIE_PURCHASE_FLOW §5).
  event_index integer not null default 0 check (event_index >= 0),
  slot bigint not null check (slot >= 0),
  event_type text not null,
  project_id uuid references projects(id),
  round_id uuid references rounds(id),
  payload jsonb not null,
  confirmation_status text not null
    check (confirmation_status in ('PROCESSED', 'CONFIRMED', 'FINALIZED', 'FAILED', 'RETRACTED')),
  block_time timestamptz,
  indexed_at timestamptz not null default now(),
  unique (chain, signature, instruction_index, event_index)
);

create index chain_events_round_block_time_idx on chain_events(round_id, block_time desc);

-- Canonical events are append-only except for forward confirmation progress.
-- Provisional events may be retracted; FINALIZED, FAILED, and RETRACTED are terminal.
create function guard_chain_event_mutation() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'chain_events is append-only' using errcode = 'restrict_violation';
  end if;

  if (new.id, new.chain, new.program_id, new.signature, new.instruction_index, new.event_index,
      new.slot, new.event_type, new.project_id, new.round_id, new.payload, new.indexed_at)
     is distinct from
     (old.id, old.chain, old.program_id, old.signature, old.instruction_index, old.event_index,
      old.slot, old.event_type, old.project_id, old.round_id, old.payload, old.indexed_at)
     or (old.block_time is not null and new.block_time is distinct from old.block_time) then
    raise exception 'only confirmation_status and a missing block_time may change'
      using errcode = 'restrict_violation';
  end if;

  if new.confirmation_status <> old.confirmation_status and (
       old.confirmation_status in ('FINALIZED', 'FAILED', 'RETRACTED')
       or (new.confirmation_status = 'PROCESSED')
       or (new.confirmation_status = 'CONFIRMED' and old.confirmation_status <> 'PROCESSED')
     ) then
    raise exception 'invalid confirmation transition % -> %', old.confirmation_status, new.confirmation_status
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger chain_events_guard
  before update or delete on chain_events
  for each row execute function guard_chain_event_mutation();

-- Nessie funding saga and subscription intents --------------------------------
-- NESSIE_PURCHASE_FLOW §5–§7; owned by the Nessie integration. Amounts are BIGINT
-- micro-USD like the market tables; Nessie balances are the provider's integer dollars, named *_usd.

create type banking_account_role as enum ('PARTICIPANT', 'TREASURY');
create type funding_mode as enum ('NESSIE', 'FAUCET_ONLY');
create type funding_status as enum (
  'CREATED', 'BANK_DISPATCHED', 'BANK_PENDING', 'BANK_UNKNOWN', 'BANK_CONFIRMED',
  'BANK_REJECTED', 'MINT_PREPARED', 'MINT_SUBMITTED', 'MINT_CONFIRMED', 'COMPLETED',
  'NEEDS_REVIEW', 'COMPENSATION_PREPARED', 'COMPENSATION_PENDING',
  'COMPENSATION_UNKNOWN', 'COMPENSATED'
);
create type banking_attempt_purpose as enum ('FUNDING', 'COMPENSATION');
-- PREPARED is persisted before the POST leaves the process; a crash after that
-- point is treated as UNKNOWN, never as "not sent".
create type banking_dispatch_state as enum ('PREPARED', 'DISPATCHED', 'RESPONDED', 'UNKNOWN');
-- Shared by wallet-signed and relayer-signed transactions (M§11.1).
create type chain_tx_status as enum (
  'PREPARED', 'SUBMITTED', 'CONFIRMED', 'FINALIZED', 'FAILED', 'UNKNOWN', 'EXPIRED', 'REJECTED'
);

create table banking_accounts (
  id uuid primary key default gen_random_uuid(),
  generation text not null,
  identity_id uuid references identities(id),
  role banking_account_role not null,
  provider_customer_id text not null,
  provider_account_id text not null,
  active boolean not null default true,
  last_observed_balance_usd bigint,
  last_observed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (generation, provider_account_id),
  -- Treasury has no owner; every participant account has exactly one.
  check ((role = 'TREASURY') = (identity_id is null))
);

create unique index banking_accounts_one_active_per_identity_role
  on banking_accounts(generation, identity_id, role)
  where active and identity_id is not null;
create unique index banking_accounts_one_active_treasury
  on banking_accounts(generation) where active and role = 'TREASURY';

create table funding_intents (
  id uuid primary key default gen_random_uuid(),
  generation text not null,
  identity_id uuid not null references identities(id),
  wallet_address text not null references wallets(address),
  amount_micro_usd bigint not null
    check (amount_micro_usd > 0 and amount_micro_usd <= 1000000000),
  mode funding_mode not null,
  source_banking_account_id uuid references banking_accounts(id),
  treasury_banking_account_id uuid references banking_accounts(id),
  provider_profile text,
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  correlation_tag text not null unique,
  status funding_status not null default 'CREATED',
  -- Canonical proof inputs are persisted once; the hash is what FundingReceipt stores.
  bank_proof_input jsonb,
  bank_proof_hash text check (bank_proof_hash ~ '^[a-f0-9]{64}$'),
  last_error text,
  next_attempt_at timestamptz,
  -- Worker claim: advance only with CAS on fencing_counter (purchase flow §5).
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_counter bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (identity_id, idempotency_key),
  -- Nessie mode is whole simulated dollars and always has bank-side mappings;
  -- faucet-only never carries provider fields.
  check (
    (mode = 'NESSIE'
      and amount_micro_usd % 1000000 = 0
      and source_banking_account_id is not null
      and treasury_banking_account_id is not null
      and provider_profile is not null)
    or
    (mode = 'FAUCET_ONLY'
      and source_banking_account_id is null
      and treasury_banking_account_id is null
      and provider_profile is null)
  )
);

-- At most one unresolved funding per source account. Only conclusive outcomes
-- release the gate; BANK_UNKNOWN / NEEDS_REVIEW / mint-unknown keep it.
create unique index funding_intents_one_unresolved_per_source
  on funding_intents(source_banking_account_id)
  where status not in ('COMPLETED', 'BANK_REJECTED', 'COMPENSATED');
create index funding_intents_identity_created_idx on funding_intents(identity_id, created_at desc);
create index funding_intents_recovery_idx on funding_intents(next_attempt_at)
  where status not in ('COMPLETED', 'BANK_REJECTED', 'COMPENSATED');

create table banking_attempts (
  id uuid primary key default gen_random_uuid(),
  funding_intent_id uuid not null references funding_intents(id),
  attempt_ordinal integer not null check (attempt_ordinal > 0),
  purpose banking_attempt_purpose not null,
  correlation_tag text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  dispatch_state banking_dispatch_state not null default 'PREPARED',
  sent_at timestamptz,
  outcome text,
  provider_transfer_id text unique,
  provider_status text,
  -- Parsed, redacted response only: no API key, no raw request URL.
  sanitized_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (funding_intent_id, attempt_ordinal)
);

create table funding_chain_attempts (
  id uuid primary key default gen_random_uuid(),
  funding_intent_id uuid not null references funding_intents(id),
  attempt_ordinal integer not null check (attempt_ordinal > 0),
  message_hash text not null check (message_hash ~ '^[a-f0-9]{64}$'),
  -- Fully signed relayer transaction; server/worker only, never returned by the API.
  signed_tx bytea not null,
  signature text not null unique,
  blockhash text not null,
  last_valid_block_height bigint not null check (last_valid_block_height >= 0),
  status chain_tx_status not null default 'PREPARED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (funding_intent_id, attempt_ordinal)
);

-- Append-only audit of every funding state change, including operator
-- review resolutions (which must cite evidence and an actor).
create table funding_transitions (
  id uuid primary key default gen_random_uuid(),
  funding_intent_id uuid not null references funding_intents(id),
  from_status funding_status,
  to_status funding_status not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  actor text not null,
  reason text,
  created_at timestamptz not null default now()
);
create index funding_transitions_intent_idx on funding_transitions(funding_intent_id, created_at);

create trigger funding_transitions_append_only
  before update or delete on funding_transitions
  for each row execute function reject_append_only_mutation();

create table subscription_intents (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references identities(id),
  round_id uuid not null references rounds(id),
  wallet_address text not null references wallets(address),
  gross_amount_micro_usd bigint not null check (gross_amount_micro_usd > 0),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  -- Exact relayer-partially-signed message; submitted bytes must match it.
  prepared_message bytea not null,
  message_hash text not null check (message_hash ~ '^[a-f0-9]{64}$'),
  signature text unique,
  blockhash text not null,
  last_valid_block_height bigint not null check (last_valid_block_height >= 0),
  status chain_tx_status not null default 'PREPARED',
  preview jsonb not null check (jsonb_typeof(preview) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (identity_id, idempotency_key)
);

-- One live or consumed participation per identity per round, across all of its
-- wallets. Released only by conclusive no-effect outcomes after reconciliation.
create unique index subscription_intents_one_per_identity_round
  on subscription_intents(round_id, identity_id)
  where status not in ('FAILED', 'EXPIRED', 'REJECTED');

-- Operations ----------------------------------------------------------------

-- §11.2: same key + same request hash replays the stored response; a different hash is a 409.
create table idempotency_keys (
  identity_id uuid not null references identities(id),
  operation text not null,
  key text not null check (length(key) between 8 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (identity_id, operation, key)
);

-- Fixed-window counters for per-identity, per-wallet, and per-IP limits (§10.2), upserted by
-- bucket key, e.g. 'subscribe:identity:<uuid>'.
create table rate_limits (
  bucket text not null check (length(bucket) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 1 check (hits > 0),
  primary key (bucket, window_start)
);

-- Indexer/reconciliation cursor per program (§11.3).
create table indexer_state (
  program_id text primary key,
  last_signature text,
  last_slot bigint check (last_slot >= 0),
  updated_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  actor_identity_id uuid references identities(id),
  action text not null,
  target_type text not null,
  target_id text not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function reject_append_only_mutation();

-- Dashboard read models (MARKET ARCHITECTURE §6.1, §8.2–8.3) --------------------
-- Derived only; never authoritative.

-- The indexer writes these rows in the same transaction as the FINALIZED chain_events row
-- they derive from, so dashboards can be rebuilt from canonical events (§11.4).
create table market_metrics (
  observed_at timestamptz not null,
  project_id uuid not null references projects(id),
  round_id uuid references rounds(id),
  chain_event_id uuid not null references chain_events(id),
  metric_code text not null check (metric_code in (
    'SUBSCRIPTION_GROSS_MICRO_USD',
    'SUBSCRIPTION_ACCEPTED_MICRO_USD',
    'PROTOCOL_FEE_MICRO_USD',
    'FOUNDER_REWARD_MICRO_USD',
    'REFUND_MICRO_USD',
    'RECEIPT_UNITS_MINTED',
    -- 1 for an identity's first finalized subscription to the project; summing it gives
    -- cumulative unique participants, which per-bucket COUNT(DISTINCT) cannot.
    'NEW_PARTICIPANT'
  )),
  value bigint not null check (value >= 0),
  dimensions jsonb not null default '{}'::jsonb check (jsonb_typeof(dimensions) = 'object'),
  unique (observed_at, chain_event_id, metric_code)
) with (
  tsdb.hypertable,
  tsdb.partition_column = 'observed_at',
  tsdb.segmentby = 'project_id',
  tsdb.orderby = 'observed_at desc'
);

create trigger market_metrics_append_only
  before update or delete on market_metrics
  for each row execute function reject_append_only_mutation('market_metrics');

-- Real-time aggregates (materialized_only = false) so the demo shows new rows immediately.
-- WITH NO DATA because dbmate runs the migration in a transaction.

create materialized view project_metrics_1m
with (timescaledb.continuous, timescaledb.materialized_only = false) as
select project_id,
       metric_code,
       time_bucket(interval '1 minute', observed_at) as bucket,
       sum(value) as total,
       count(*) as events
  from market_metrics
 group by project_id, metric_code, time_bucket(interval '1 minute', observed_at)
with no data;

create materialized view project_metrics_1h
with (timescaledb.continuous, timescaledb.materialized_only = false) as
select project_id,
       metric_code,
       time_bucket(interval '1 hour', bucket) as bucket,
       sum(total) as total,
       sum(events) as events
  from project_metrics_1m
 group by project_id, metric_code, time_bucket(interval '1 hour', bucket)
with no data;

-- Running totals are computed when querying (window functions over this view).
create materialized view round_funding_progress
with (timescaledb.continuous, timescaledb.materialized_only = false) as
select round_id,
       project_id,
       time_bucket(interval '1 minute', observed_at) as bucket,
       coalesce(sum(value) filter (where metric_code = 'SUBSCRIPTION_GROSS_MICRO_USD'), 0) as committed_micro_usd,
       coalesce(sum(value) filter (where metric_code = 'SUBSCRIPTION_ACCEPTED_MICRO_USD'), 0) as accepted_micro_usd,
       count(*) filter (where metric_code = 'SUBSCRIPTION_GROSS_MICRO_USD') as subscriptions
  from market_metrics
 where round_id is not null
 group by round_id, project_id, time_bucket(interval '1 minute', observed_at)
with no data;

-- "Implied valuation history" (not stock-price candles), from immutable snapshots.
create materialized view project_valuation_daily
with (timescaledb.continuous, timescaledb.materialized_only = false) as
select project_id,
       time_bucket(interval '1 day', calculated_at) as bucket,
       first(round_implied_value, calculated_at) as open_value,
       max(round_implied_value) as high_value,
       min(round_implied_value) as low_value,
       last(round_implied_value, calculated_at) as close_value,
       last(model_reference_value, calculated_at) as close_model_reference_value,
       last(unit_price_micro_usd, calculated_at) as close_unit_price_micro_usd,
       count(*) as snapshots
  from valuation_snapshots
 group by project_id, time_bucket(interval '1 day', calculated_at)
with no data;

create materialized view project_participant_growth
with (timescaledb.continuous, timescaledb.materialized_only = false) as
select project_id,
       time_bucket(interval '1 day', observed_at) as bucket,
       sum(value) as new_participants
  from market_metrics
 where metric_code = 'NEW_PARTICIPANT'
 group by project_id, time_bucket(interval '1 day', observed_at)
with no data;

create materialized view project_founder_rewards_daily
with (timescaledb.continuous, timescaledb.materialized_only = false) as
select project_id,
       time_bucket(interval '1 day', observed_at) as bucket,
       sum(value) as founder_reward_micro_usd
  from market_metrics
 where metric_code = 'FOUNDER_REWARD_MICRO_USD'
 group by project_id, time_bucket(interval '1 day', observed_at)
with no data;

select add_continuous_aggregate_policy('project_metrics_1m',
  start_offset => interval '7 days', end_offset => interval '1 minute', schedule_interval => interval '1 minute');
select add_continuous_aggregate_policy('project_metrics_1h',
  start_offset => interval '30 days', end_offset => interval '1 hour', schedule_interval => interval '15 minutes');
select add_continuous_aggregate_policy('round_funding_progress',
  start_offset => interval '7 days', end_offset => interval '1 minute', schedule_interval => interval '1 minute');
select add_continuous_aggregate_policy('project_valuation_daily',
  start_offset => interval '90 days', end_offset => interval '1 day', schedule_interval => interval '1 hour');
select add_continuous_aggregate_policy('project_participant_growth',
  start_offset => interval '90 days', end_offset => interval '1 day', schedule_interval => interval '1 hour');
select add_continuous_aggregate_policy('project_founder_rewards_daily',
  start_offset => interval '90 days', end_offset => interval '1 day', schedule_interval => interval '1 hour');

-- Runtime role ----------------------------------------------------------------
-- Used by the API and worker. Migrations run as the owner (tsdbadmin on Tiger Cloud).
-- The app gets no DELETE/TRUNCATE/DDL anywhere and no UPDATE on append-only history.
-- Set the password per environment, never in a migration:
--   alter role prospecto_app password '<secret>';
do $$
begin
  if not exists (select from pg_roles where rolname = 'prospecto_app') then
    create role prospecto_app login;
  end if;
end;
$$;

grant usage on schema public, auth to prospecto_app;
grant select on all tables in schema public to prospecto_app;

-- Better Auth manages its own rows, including deleting expired sessions and OTPs.
grant select, insert, update, delete on all tables in schema auth to prospecto_app;

grant insert on
  identities, wallets, wallet_challenges,
  projects, project_members, profile_snapshots, ai_intake_proposals, evidence_claims, evidence_verifications,
  model_versions, score_snapshots, valuation_snapshots, traction_metrics,
  rounds, subscriptions, chain_events, market_metrics,
  banking_accounts, funding_intents, banking_attempts, funding_chain_attempts, funding_transitions,
  subscription_intents, idempotency_keys, rate_limits, indexer_state, audit_log
  to prospecto_app;

-- Mutable state only; triggers further restrict model_versions, rounds, and chain_events.
grant update on
  identities, wallets, wallet_challenges, projects, project_members, profile_snapshots, model_versions,
  rounds, subscriptions, chain_events,
  banking_accounts, funding_intents, banking_attempts, funding_chain_attempts,
  subscription_intents, idempotency_keys, rate_limits, indexer_state
  to prospecto_app;

-- Future migrations must grant write access explicitly.
alter default privileges in schema public grant select on tables to prospecto_app;

-- migrate:down
-- Rollback for a fresh environment only; it discards all data.
alter default privileges in schema public revoke select on tables from prospecto_app;
revoke all on all tables in schema public from prospecto_app;
revoke all on all tables in schema auth from prospecto_app;
revoke usage on schema public, auth from prospecto_app;
drop role if exists prospecto_app;

drop materialized view if exists project_founder_rewards_daily;
drop materialized view if exists project_participant_growth;
drop materialized view if exists project_valuation_daily;
drop materialized view if exists round_funding_progress;
drop materialized view if exists project_metrics_1h;
drop materialized view if exists project_metrics_1m;
drop table if exists market_metrics;

drop table if exists audit_log;
drop table if exists indexer_state;
drop table if exists rate_limits;
drop table if exists idempotency_keys;

drop table if exists subscription_intents;
drop table if exists funding_transitions;
drop table if exists funding_chain_attempts;
drop table if exists banking_attempts;
drop table if exists funding_intents;
drop table if exists banking_accounts;
drop type if exists chain_tx_status;
drop type if exists banking_dispatch_state;
drop type if exists banking_attempt_purpose;
drop type if exists funding_status;
drop type if exists funding_mode;
drop type if exists banking_account_role;

drop table if exists chain_events;
drop function if exists guard_chain_event_mutation();
drop table if exists subscriptions;
alter table if exists valuation_snapshots drop constraint if exists valuation_snapshots_prior_round_fk;
drop table if exists rounds;
drop function if exists guard_round_terms();
drop table if exists traction_metrics;
drop table if exists valuation_snapshots;
drop table if exists score_snapshots;
drop table if exists model_versions;
drop function if exists guard_model_version_mutation();
drop view if exists evidence_claim_current_status;
drop table if exists evidence_verifications;
drop table if exists evidence_claims;
drop table if exists ai_intake_proposals;
drop table if exists profile_snapshots;
drop table if exists project_members;
drop table if exists projects;
drop table if exists sectors;
drop table if exists wallet_challenges;
drop table if exists wallets;
drop function if exists guard_wallet_binding();
drop table if exists identities;

drop table if exists auth.verification;
drop table if exists auth.account;
drop table if exists auth.session;
drop table if exists auth."user";
drop schema if exists auth;

drop function if exists reject_append_only_mutation();
drop type if exists subscription_status;
drop type if exists round_status;
drop type if exists model_version_status;
drop type if exists evidence_status;
drop type if exists evidence_source_type;
drop type if exists project_member_role;
drop type if exists profile_snapshot_source;
drop type if exists entity_type;
drop type if exists project_status;
drop type if exists project_stage;
drop type if exists platform_role;
drop type if exists identity_verification_status;
drop type if exists identity_status;
