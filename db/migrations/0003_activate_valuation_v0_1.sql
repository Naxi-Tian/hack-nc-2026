-- migrate:up
-- Activates valuation-v0.1 (approved 2026-10-10). Once ACTIVE the model_versions trigger
-- freezes its parameters, so any weight or coefficient change needs a new version id.
-- code_commit is the last commit touching the pure model (model-value.ts, quality-scores.ts)
-- or its seed. The guard below refuses to activate parameters other than the reviewed ones.
do $$
begin
  update model_versions
     set status = 'ACTIVE',
         code_commit = 'ca03c5d7ba63869ef440b2b1a8b72714a9ef04c4'
   where id = 'valuation-v0.1'
     and status = 'DRAFT'
     and model_hash = '65a67bcfc751b4e06f371cd420c47a630dad6e08e6d2746dc518a46611787a99';
  if not exists (select 1 from model_versions where id = 'valuation-v0.1' and status = 'ACTIVE') then
    raise exception 'valuation-v0.1 is missing or its hash differs; load it with npm run db:model-sql first';
  end if;
end;
$$;

-- migrate:down
-- No-op: ACTIVE -> DRAFT is not an allowed transition. To withdraw this version, retire it
-- (status = 'RETIRED') in a new migration and activate a successor.
