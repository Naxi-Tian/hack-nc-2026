-- migrate:up
create extension if not exists pgcrypto;

create type identity_status as enum ('ACTIVE', 'SUSPENDED');
create type identity_verification_status as enum ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');
create type project_stage as enum ('IDEA', 'PROTOTYPE', 'LAUNCHED', 'EARLY_REVENUE', 'REPEATABLE_REVENUE');
create type project_status as enum ('DRAFT', 'PUBLISHED', 'ARCHIVED');
create type project_member_role as enum ('FOUNDER', 'TEAM');
create type evidence_source_type as enum ('FOUNDER_ATTESTED', 'PUBLIC_WEAK', 'REVIEWER_VERIFIED', 'INDEPENDENTLY_VERIFIED', 'MISSING_OR_CONTRADICTED');
create type round_status as enum ('DRAFT', 'SCHEDULED', 'OPEN', 'FILLED', 'EXPIRED', 'FINALIZED', 'REFUNDING');
create type subscription_status as enum ('PREPARED', 'SUBMITTED', 'CONFIRMED', 'FINALIZED', 'FAILED', 'REFUNDED');

create table identities (
  id uuid primary key default gen_random_uuid(),
  status identity_status not null default 'ACTIVE',
  verification_status identity_verification_status not null default 'NOT_STARTED',
  risk_flags jsonb not null default '[]'::jsonb check (jsonb_typeof(risk_flags) = 'array'),
  created_at timestamptz not null default now()
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

create unique index wallets_one_active_primary_per_identity
  on wallets(identity_id) where is_primary and revoked_at is null;

create table projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (length(name) between 1 and 120),
  description text not null default '',
  sector text,
  stage project_stage not null,
  status project_status not null default 'DRAFT',
  founder_identity_id uuid not null references identities(id),
  founder_wallet text references wallets(address),
  solana_project_pda text unique,
  receipt_mint text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table project_members (
  project_id uuid not null references projects(id),
  identity_id uuid not null references identities(id),
  role project_member_role not null,
  joined_at timestamptz not null default now(),
  primary key (project_id, identity_id)
);

create table evidence_claims (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  metric_code text not null check (length(metric_code) between 1 and 80),
  value_numeric numeric(30, 8),
  value_text text,
  unit text,
  period_start date,
  period_end date,
  source_type evidence_source_type not null,
  source_uri text,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  verification_status evidence_source_type not null,
  confidence_multiplier numeric(4, 3) not null check (confidence_multiplier between 0 and 1),
  created_by_identity_id uuid not null references identities(id),
  supersedes_claim_id uuid references evidence_claims(id),
  created_at timestamptz not null default now(),
  check (period_end is null or period_start is null or period_end >= period_start),
  check (value_numeric is not null or value_text is not null)
);

create index evidence_claims_project_created_idx on evidence_claims(project_id, created_at desc);

create table model_versions (
  id text primary key,
  effective_at timestamptz not null,
  stage_weights jsonb not null,
  factor_weights jsonb not null,
  normalization_rules jsonb not null,
  scenario_parameters jsonb not null,
  demand_parameters jsonb not null,
  code_commit text,
  status text not null check (status in ('DRAFT', 'ACTIVE', 'RETIRED'))
);

create table valuation_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  model_version_id text not null references model_versions(id),
  calculated_at timestamptz not null default now(),
  current_operating_value numeric(30, 8) not null check (current_operating_value >= 0),
  scenario_value numeric(30, 8) not null check (scenario_value >= 0),
  model_reference_value numeric(30, 8) not null check (model_reference_value >= 0),
  demand_score numeric(8, 7) check (demand_score between 0 and 1),
  demand_multiplier numeric(12, 8) check (demand_multiplier > 0),
  round_implied_value numeric(30, 8) check (round_implied_value >= 0),
  unit_price numeric(30, 12) check (unit_price >= 0),
  scenario_details jsonb not null,
  assumptions jsonb not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  evidence_root text check (evidence_root is null or evidence_root ~ '^[a-f0-9]{64}$'),
  unique (project_id, model_version_id, input_hash)
);

create table score_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  model_version_id text not null references model_versions(id),
  calculated_at timestamptz not null default now(),
  execution_score numeric(8, 7) not null check (execution_score between 0 and 1),
  market_score numeric(8, 7) not null check (market_score between 0 and 1),
  product_score numeric(8, 7) not null check (product_score between 0 and 1),
  traction_score numeric(8, 7) not null check (traction_score between 0 and 1),
  economics_score numeric(8, 7) not null check (economics_score between 0 and 1),
  composite_score numeric(8, 7) not null check (composite_score between 0 and 1),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  factor_contributions jsonb not null
);

create table rounds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  round_number integer not null check (round_number > 0),
  solana_round_pda text unique,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  unit_price_micro_usd bigint not null check (unit_price_micro_usd > 0),
  max_units bigint not null check (max_units > 0),
  target_amount_micro_usd bigint not null check (target_amount_micro_usd >= 0),
  model_version_id text not null references model_versions(id),
  valuation_snapshot_id uuid not null references valuation_snapshots(id),
  model_hash text not null check (model_hash ~ '^[a-f0-9]{64}$'),
  evidence_root text not null check (evidence_root ~ '^[a-f0-9]{64}$'),
  status round_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  unique (project_id, round_number),
  check (closes_at > opens_at)
);

create unique index rounds_one_open_per_project on rounds(project_id) where status = 'OPEN';

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references rounds(id),
  identity_id uuid not null references identities(id),
  wallet_address text not null references wallets(address),
  requested_amount_micro_usd bigint not null check (requested_amount_micro_usd > 0),
  accepted_amount_micro_usd bigint not null default 0 check (accepted_amount_micro_usd >= 0),
  fee_amount_micro_usd bigint not null default 0 check (fee_amount_micro_usd >= 0),
  founder_reward_micro_usd bigint not null default 0 check (founder_reward_micro_usd >= 0),
  allocated_units bigint not null default 0 check (allocated_units >= 0),
  status subscription_status not null default 'PREPARED',
  solana_signature text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (round_id, identity_id),
  unique (solana_signature)
);

create table chain_events (
  id uuid primary key default gen_random_uuid(),
  chain text not null default 'solana' check (chain = 'solana'),
  program_id text not null,
  signature text not null,
  instruction_index integer not null check (instruction_index >= 0),
  slot bigint not null check (slot >= 0),
  event_type text not null,
  project_id uuid references projects(id),
  round_id uuid references rounds(id),
  payload jsonb not null,
  confirmation_status text not null check (confirmation_status in ('PROCESSED', 'CONFIRMED', 'FINALIZED', 'FAILED')),
  block_time timestamptz,
  indexed_at timestamptz not null default now(),
  unique (chain, signature, instruction_index)
);

create index chain_events_round_block_time_idx on chain_events(round_id, block_time desc);

create table traction_metrics (
  observed_at timestamptz not null,
  project_id uuid not null references projects(id),
  metric_code text not null,
  value numeric(30, 8) not null,
  unit text not null,
  evidence_claim_id uuid references evidence_claims(id),
  primary key (observed_at, project_id, metric_code)
);

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

-- migrate:down
drop table if exists ai_intake_proposals;
drop table if exists traction_metrics;
drop table if exists chain_events;
drop table if exists subscriptions;
drop table if exists rounds;
drop table if exists score_snapshots;
drop table if exists valuation_snapshots;
drop table if exists model_versions;
drop table if exists evidence_claims;
drop table if exists project_members;
drop table if exists projects;
drop table if exists wallets;
drop table if exists identities;
drop type if exists subscription_status;
drop type if exists round_status;
drop type if exists evidence_source_type;
drop type if exists project_member_role;
drop type if exists project_status;
drop type if exists project_stage;
drop type if exists identity_verification_status;
drop type if exists identity_status;
