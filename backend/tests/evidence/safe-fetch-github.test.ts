import { describe, expect, it } from "vitest";

import { collectGithub } from "../../src/evidence/research/github.js";
import { htmlToText, isBlockedAddress, safeFetch } from "../../src/evidence/research/safe-fetch.js";

describe("safeFetch SSRF guard", () => {
  it("blocks private, loopback, link-local, and mapped addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "0.0.0.0"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    expect(isBlockedAddress("93.184.215.14")).toBe(false);
    expect(isBlockedAddress("2606:4700::1111")).toBe(false);
  });

  it("refuses literal and DNS-resolved internal hosts before connecting", async () => {
    expect((await safeFetch("http://127.0.0.1/admin")).status).toBe("BLOCKED");
    expect((await safeFetch("http://[::1]/")).status).toBe("BLOCKED");
    expect((await safeFetch("http://169.254.169.254/latest/meta-data/")).status).toBe("BLOCKED");
    expect((await safeFetch("http://localhost/")).status).toBe("BLOCKED");
    expect((await safeFetch("file:///etc/passwd")).status).toBe("INVALID_URL");
    expect((await safeFetch("https://example.com:8443/")).status).toBe("INVALID_URL");
  });
});

describe("htmlToText", () => {
  it("keeps visible text and meta descriptions, drops scripts", () => {
    const text = htmlToText(
      `<html><head><title>Mothlight</title><meta name="description" content="Quiet rooms &amp; 1,200 students"><script>var x="ignore me"</script></head>
       <body><h1>Study at 2&nbsp;a.m.</h1><style>.a{}</style><p>Join&#x21;</p></body></html>`,
    );
    expect(text).toContain("Mothlight");
    expect(text).toContain("Quiet rooms & 1,200 students");
    expect(text).toContain("Study at 2 a.m.");
    expect(text).toContain("Join!");
    expect(text).not.toContain("ignore me");
  });
});

function fakeGithub(routes: Record<string, unknown[]>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const path = String(input).replace("https://api.github.com", "");
    calls.push(path);
    const queue = routes[path];
    if (!queue?.length) return new Response("{}", { status: 404 });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === 202) return new Response("{}", { status: 202 });
    return new Response(JSON.stringify(next), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const weeks = (last13: number[]) => ({ all: [...new Array(39).fill(9), ...last13] });

describe("collectGithub", () => {
  const repo = { full_name: "mothlight/app", html_url: "https://github.com/mothlight/app", fork: false, archived: false, pushed_at: "2026-10-01T00:00:00Z" };

  it("verifies activity when the repo homepage points at the project domain", async () => {
    const { fetchImpl } = fakeGithub({
      "/repos/mothlight/app": [{ ...repo, homepage: "https://mothlight.app" }],
      "/users/mothlight": [{ blog: "" }],
      "/repos/mothlight/app/stats/participation": [202, weeks([0, 3, 0, 5, 1, 0, 0, 2, 4, 0, 6, 1, 2])],
    });
    const result = await collectGithub({ owner: "mothlight", repo: "app" }, "mothlight.app", { fetchImpl, retryDelayMs: 0 });
    expect(result.claims).toEqual([
      expect.objectContaining({ metric_code: "repo_commits_90d", value_numeric: "24", status: "INDEPENDENTLY_VERIFIED" }),
      expect.objectContaining({ metric_code: "repo_active_weeks_13w", value_numeric: "8", status: "INDEPENDENTLY_VERIFIED" }),
    ]);
  });

  it("downgrades unattributed repositories (someone else's famous repo) to PUBLIC_WEAK", async () => {
    const { fetchImpl } = fakeGithub({
      "/repos/facebook/react": [{ ...repo, full_name: "facebook/react", homepage: "https://react.dev" }],
      "/users/facebook": [{ blog: "https://opensource.fb.com" }],
      "/repos/facebook/react/stats/participation": [weeks(new Array(13).fill(40))],
    });
    const result = await collectGithub({ owner: "facebook", repo: "react" }, "mothlight.app", { fetchImpl });
    expect(result.claims.every((claim) => claim.status === "PUBLIC_WEAK")).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/weakly attributed/);
  });

  it("returns a warning, not a guess, when stats are still computing", async () => {
    const { fetchImpl } = fakeGithub({
      "/repos/mothlight/app": [{ ...repo, homepage: null }],
      "/users/mothlight": [{ blog: null }],
      "/repos/mothlight/app/stats/participation": [202],
    });
    const result = await collectGithub({ owner: "mothlight", repo: "app" }, "mothlight.app", { fetchImpl, retryDelayMs: 0 });
    expect(result.claims).toEqual([]);
    expect(result.warnings[0]).toMatch(/still being computed/);
  });
});
