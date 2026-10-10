// Prints SQL that loads db/seeds/<version>.json into model_versions (BACKEND_STACK §5.7).
//   npm run -s db:model-sql | tiger db query <service> --file /dev/stdin
// Idempotent. A DRAFT row is refreshed from the seed; an ACTIVE or RETIRED row is frozen by the
// model_versions trigger, so changed parameters for one need a new version id.
import { readFileSync } from "node:fs";

import { modelHash, parseValuationParams } from "../src/valuation/model-value.js";
import { DEFAULT_MODEL_VERSION_ID, modelDocument } from "../src/valuation/service.js";

const id = process.argv[2] ?? DEFAULT_MODEL_VERSION_ID;
if (!/^[a-z0-9.-]+$/.test(id)) throw new Error(`invalid model version id: ${id}`);
const seed = JSON.parse(readFileSync(new URL(`../../db/seeds/${id}.json`, import.meta.url), "utf8"));
if (seed.id !== id) throw new Error(`seed id ${seed.id} does not match file name ${id}`);

const document = modelDocument(seed);
parseValuationParams(document); // Fail before printing anything if the parameters are invalid.
const hash = modelHash(document);

const json = (value: unknown) => {
  const text = JSON.stringify(value);
  if (text.includes("$seed$")) throw new Error("seed contains the dollar-quote tag");
  return `$seed$${text}$seed$::jsonb`;
};

console.log(`insert into model_versions
  (id, effective_at, stage_weights, factor_weights, normalization_rules, scenario_parameters, demand_parameters, model_hash, status)
values ('${id}', now(), ${json(document.stage_weights)}, ${json(document.factor_weights)}, ${json(document.normalization_rules)},
        ${json(document.scenario_parameters)}, ${json(document.demand_parameters)}, '${hash}', 'DRAFT')
on conflict (id) do update set
  stage_weights = excluded.stage_weights, factor_weights = excluded.factor_weights,
  normalization_rules = excluded.normalization_rules, scenario_parameters = excluded.scenario_parameters,
  demand_parameters = excluded.demand_parameters, model_hash = excluded.model_hash
where model_versions.status = 'DRAFT';
select id, status, model_hash from model_versions where id = '${id}';`);
