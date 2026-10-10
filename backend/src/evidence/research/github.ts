// Deterministic GitHub collector (no AI). Activity numbers come straight from the GitHub REST API,
// but a founder can paste any repository, so attribution decides the evidence level:
// INDEPENDENTLY_VERIFIED only when the repo's homepage or the owner's profile site points at the
// project's own domain; otherwise PUBLIC_WEAK ("public but weakly attributable", M§4.5).
import { z } from "zod";

import { siteKey } from "./urls.js";

const API = "https://api.github.com";
const MAX_REPOS = 3;

export interface CollectedClaim {
  metric_code: "repo_commits_90d" | "repo_active_weeks_13w";
  value_numeric: string;
  status: "INDEPENDENTLY_VERIFIED" | "PUBLIC_WEAK";
  source_url: string;
  method: string;
  detail: string;
}

export interface GithubCollection {
  claims: CollectedClaim[];
  warnings: string[];
}

const repoSchema = z.object({
  full_name: z.string(),
  html_url: z.string(),
  homepage: z.string().nullable().optional(),
  fork: z.boolean(),
  archived: z.boolean(),
  pushed_at: z.string().nullable(),
});
const ownerSchema = z.object({ blog: z.string().nullable().optional() });
const participationSchema = z.object({ all: z.array(z.number().int().nonnegative()).length(52) });

type Fetch = typeof fetch;

function hostKey(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return siteKey(new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname);
  } catch {
    return null;
  }
}

export async function collectGithub(
  target: { owner: string; repo: string | null },
  projectSiteKey: string | null,
  options: { fetchImpl?: Fetch; token?: string; retryDelayMs?: number } = {},
): Promise<GithubCollection> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const warnings: string[] = [];
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "prospecto-evidence",
  };
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  const get = async (path: string): Promise<Response> =>
    fetchImpl(`${API}${path}`, { headers, signal: AbortSignal.timeout(8_000) });

  const owner = encodeURIComponent(target.owner);
  let repos: z.infer<typeof repoSchema>[];
  if (target.repo) {
    const response = await get(`/repos/${owner}/${encodeURIComponent(target.repo)}`);
    if (!response.ok) return { claims: [], warnings: [`GitHub repository not readable (HTTP ${response.status}).`] };
    repos = [repoSchema.parse(await response.json())];
  } else {
    const response = await get(`/users/${owner}/repos?sort=pushed&per_page=20&type=owner`);
    if (!response.ok) return { claims: [], warnings: [`GitHub account not readable (HTTP ${response.status}).`] };
    repos = z
      .array(repoSchema)
      .parse(await response.json())
      .filter((repo) => !repo.fork && !repo.archived)
      .slice(0, MAX_REPOS);
  }
  if (repos.length === 0) return { claims: [], warnings: ["No public, non-fork GitHub repositories found."] };

  const ownerResponse = await get(`/users/${owner}`);
  const ownerSite = ownerResponse.ok ? hostKey(ownerSchema.parse(await ownerResponse.json()).blog) : null;
  const attributed =
    projectSiteKey !== null &&
    (ownerSite === projectSiteKey || repos.some((repo) => hostKey(repo.homepage) === projectSiteKey));

  // Weekly commit totals for the last 52 weeks. GitHub answers 202 while it computes the stats.
  const weekly = new Array<number>(13).fill(0);
  let counted = 0;
  for (const repo of repos) {
    const path = `/repos/${repo.full_name.split("/").map(encodeURIComponent).join("/")}/stats/participation`;
    let response = await get(path);
    if (response.status === 202) {
      await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 1_500));
      response = await get(path);
    }
    if (response.status !== 200) {
      warnings.push(`GitHub activity for ${repo.full_name} is still being computed; try again in a minute.`);
      continue;
    }
    const last13 = participationSchema.parse(await response.json()).all.slice(-13);
    last13.forEach((count, index) => (weekly[index] += count));
    counted += 1;
  }
  if (counted === 0) return { claims: [], warnings };

  const status = attributed ? "INDEPENDENTLY_VERIFIED" : "PUBLIC_WEAK";
  const source_url = target.repo ? repos[0].html_url : `https://github.com/${target.owner}`;
  const names = repos.map((repo) => repo.full_name).join(", ");
  const method = attributed ? "system:github-api;attributed" : "system:github-api;unattributed";
  if (!attributed) {
    warnings.push(
      "GitHub activity counts as weakly attributed. Set the repository's website (or your GitHub profile site) to your startup's domain to make it independently verified.",
    );
  }
  // 13 weeks ≈ 91 days; documented as the 90-day window.
  return {
    claims: [
      {
        metric_code: "repo_commits_90d",
        value_numeric: String(weekly.reduce((sum, count) => sum + count, 0)),
        status,
        source_url,
        method,
        detail: `Sum of weekly commits, last 13 weeks: ${names}`,
      },
      {
        metric_code: "repo_active_weeks_13w",
        value_numeric: String(weekly.filter((count) => count > 0).length),
        status,
        source_url,
        method,
        detail: `Weeks with ≥1 commit, last 13 weeks: ${names}`,
      },
    ],
    warnings,
  };
}
