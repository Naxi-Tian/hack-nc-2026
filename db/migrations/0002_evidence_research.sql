-- migrate:up
-- Evidence research runs (docs/EVIDENCE_RESEARCH.md). Gemini proposals are cached in
-- research_runs.result and are never authoritative; only founder-confirmed proposals become
-- evidence_claims, with the system-assigned status written to evidence_verifications.

-- Gemini judgment-factor assessments (EVIDENCE_RESEARCH §4). Multiplier lives in model_versions.
-- ADD VALUE is allowed inside dbmate's transaction because nothing below uses the new values.
alter type evidence_status add value if not exists 'AI_ASSESSED' before 'MISSING_OR_CONTRADICTED';
alter type evidence_source_type add value if not exists 'AI_ASSESSMENT';

create type research_run_status as enum ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

create table research_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  requested_by_identity_id uuid not null references identities(id),
  status research_run_status not null default 'QUEUED',
  -- Submitted URLs and founder text. Private evidence: never returned by public endpoints.
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  pipeline_version text not null,
  model text not null,
  lease_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  search_query_count integer not null default 0 check (search_query_count >= 0),
  total_tokens integer check (total_tokens >= 0),
  -- { proposals[], rejected[], warnings[], sources[] } produced by the deterministic verifier.
  result jsonb check (result is null or jsonb_typeof(result) = 'object'),
  confirmed_at timestamptz,
  confirmed_by_identity_id uuid references identities(id),
  created_at timestamptz not null default now(),
  check ((status in ('SUCCEEDED', 'PARTIAL')) = (result is not null)),
  check ((status = 'FAILED') = (error_code is not null)),
  check (confirmed_at is null or status in ('SUCCEEDED', 'PARTIAL')),
  check ((confirmed_at is null) = (confirmed_by_identity_id is null))
);

-- At most one in-flight run per project.
create unique index research_runs_one_active on research_runs(project_id) where status in ('QUEUED', 'RUNNING');
create index research_runs_project_created_idx on research_runs(project_id, created_at desc);
create index research_runs_cache_idx on research_runs(project_id, input_hash, pipeline_version, model, created_at desc)
  where status in ('SUCCEEDED', 'PARTIAL');

create table research_sources (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references research_runs(id),
  url text not null,
  final_url text,
  origin text not null check (origin in ('FOUNDER_SUBMITTED', 'SEARCH_CITATION')),
  founder_controlled boolean not null,
  fetch_status text not null,
  http_status integer,
  content_type text,
  content_sha256 text check (content_sha256 ~ '^[a-f0-9]{64}$'),
  -- Extracted public page text (capped by the fetcher) so quote checks can be re-audited.
  text_excerpt text,
  grounding_seen boolean not null default false,
  fetched_at timestamptz not null default now(),
  unique (run_id, url)
);

create trigger research_sources_append_only
  before update or delete on research_sources
  for each row execute function reject_append_only_mutation();

-- Provenance for claims created from a research run. Adding nullable columns does not touch
-- existing rows, so the append-only trigger on evidence_claims is unaffected.
alter table evidence_claims
  add column source_quote text check (source_quote is null or length(source_quote) <= 600),
  add column research_run_id uuid references research_runs(id),
  add column research_source_id uuid references research_sources(id);

create index evidence_claims_research_run_idx on evidence_claims(research_run_id) where research_run_id is not null;

grant insert, update on research_runs to prospecto_app;
grant insert on research_sources to prospecto_app;

-- migrate:down
-- Enum values added above cannot be dropped in PostgreSQL; they stay unused after rollback.
revoke all on research_sources, research_runs from prospecto_app;
drop index if exists evidence_claims_research_run_idx;
alter table evidence_claims
  drop column if exists research_source_id,
  drop column if exists research_run_id,
  drop column if exists source_quote;
drop table if exists research_sources;
drop table if exists research_runs;
drop type if exists research_run_status;
