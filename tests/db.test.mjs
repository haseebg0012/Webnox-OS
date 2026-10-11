// M0 covers deployment plumbing only. M2 adds the PGlite schema and the first
// cross-workspace isolation test here, before any business feature is built.
import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../server.js";
import "./database.mjs";

const configured = {
  SUPABASE_URL: "https://fixture.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_fixture",
  SUPABASE_SECRET_KEY: "sb_secret_server_only_fixture",
  SITE_URL: "https://fixture.example",
};

async function withServer(env, run, factory) {
  const server = createApp(env, factory).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("public config releases exactly the two browser-safe values", async () => {
  await withServer(configured, async (base) => {
    const response = await fetch(`${base}/api/config`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      supabaseUrl: configured.SUPABASE_URL,
      supabasePublishableKey: configured.SUPABASE_PUBLISHABLE_KEY,
    });
  });
});

test("Master API refuses valid business sessions before performing privileged operations", async () => {
  let privilegedCalls = 0;
  const factory = (_url, key) =>
    key === configured.SUPABASE_SECRET_KEY
      ? {
          auth: {
            getUser: async (token) =>
              token === "valid"
                ? { data: { user: { id: "fixture-member" } } }
                : { error: { message: "invalid" } },
            admin: {
              createUser: async () => {
                privilegedCalls++;
                throw new Error("must not run");
              },
            },
          },
        }
      : {
          rpc: async () => ({
            data: {
              profile: {
                id: "fixture-member",
                is_master: false,
                status: "active",
                account_type: "member",
              },
              workspace: { id: "fixture-workspace", status: "active" },
            },
          }),
        };
  await withServer(
    configured,
    async (base) => {
      for (const route of [
        "/api/master/workspaces",
        "/api/master/unknown",
        "/api/members",
      ]) {
        const response = await fetch(base + route, {
          method: "POST",
          headers: {
            Authorization: "Bearer valid",
            "Content-Type": "application/json",
          },
          body: "{}",
        });
        assert.equal(response.status, 403, route);
      }
      assert.equal(
        (
          await fetch(base + "/api/master/workspaces", {
            headers: { Authorization: "Bearer invalid" },
          })
        ).status,
        401,
      );
      assert.equal(privilegedCalls, 0);
    },
    factory,
  );
});

test("public branding is limited to name, logo and slug; negative lookups are indistinguishable", async () => {
  const factory = () => ({
    rpc: async () => ({ data: true }),
    from(table) {
      const f = {};
      const chain = {
        select() {
          return chain;
        },
        eq(k, v) {
          f[k] = v;
          return chain;
        },
        in(k, v) {
          f[k] = v;
          return chain;
        },
        async maybeSingle() {
          if (table === "profiles")
            return {
              data:
                f.email === "active@fixture.invalid"
                  ? { workspace_id: "fixture-workspace" }
                  : null,
            };
          return {
            data:
              f.id === "fixture-workspace" || f.slug === "fixture"
                ? { name: "Fixture", logo_url: null, slug: "fixture" }
                : null,
          };
        },
      };
      return chain;
    },
  });
  await withServer(
    configured,
    async (base) => {
      const post = (body) =>
        fetch(base + "/api/public/workspace-brand", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      for (const email of [
        "unknown@fixture.invalid",
        "inactive@fixture.invalid",
        "master@fixture.invalid",
        "suspended@fixture.invalid",
      ]) {
        const response = await post({ email });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {});
      }
      const response = await post({ email: "active@fixture.invalid" });
      assert.deepEqual(await response.json(), {
        name: "Fixture",
        logo_url: null,
        slug: "fixture",
      });
      assert.equal(response.headers.get("cache-control"), "no-store");
    },
    factory,
  );
  await withServer(
    configured,
    async (base) => {
      const response = await fetch(base + "/api/public/workspace-brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      assert.equal(response.status, 429);
    },
    () => ({ rpc: async () => ({ data: false }) }),
  );
});

test("public lead API whitelists data, rejects invalid forms and enforces the rate limit", async () => {
  const token = "a".repeat(64),
    calls = [];
  let allowed = true;
  const factory = () => ({
    rpc: async (name, args) => {
      if (name === "check_public_rate_limit") return { data: allowed };
      calls.push(args);
      return args.form_token === token
        ? { data: null }
        : { error: { message: "unavailable" } };
    },
    from() {
      let supplied;
      const chain = {
        select() {
          return chain;
        },
        eq(_k, v) {
          supplied = v;
          return chain;
        },
        in() {
          return chain;
        },
        async maybeSingle() {
          return {
            data:
              supplied === token ? { name: "Fixture", slug: "fixture" } : null,
          };
        },
      };
      return chain;
    },
  });
  await withServer(
    configured,
    async (base) => {
      const payload = {
        token,
        name: "Contact",
        company: "Company",
        email: "contact@fixture.invalid",
        phone: "",
        website: "",
        country: "",
        niche: "",
        service: "",
        notes: "",
        currency: "PKR",
        budget: 100,
        workspace_id: "forged",
        agent_id: "forged",
        stage: "won",
      };
      const post = (body) =>
        fetch(base + "/api/public/lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      assert.deepEqual(
        await (await fetch(base + "/api/public/form?token=" + token)).json(),
        { name: "Fixture", slug: "fixture" },
      );
      assert.equal(
        (await fetch(base + "/api/public/form?token=bad")).status,
        404,
      );
      assert.equal((await post(payload)).status, 201);
      assert.equal(calls.length, 1);
      for (const key of ["workspace_id", "agent_id", "stage", "token"])
        assert.equal(key in calls[0].payload, false);
      assert.equal((await post({ ...payload, fax: "bot" })).status, 201);
      assert.equal(calls.length, 1);
      assert.equal((await post({ ...payload, company: "" })).status, 400);
      assert.equal(
        (await post({ ...payload, token: "b".repeat(64) })).status,
        400,
      );
      allowed = false;
      const limited = await post(payload);
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get("retry-after"), "60");
    },
    factory,
  );
});

test("missing or malformed config fails closed without leaking values", async () => {
  const legacyServiceKey = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  const invalid = [
    {},
    { ...configured, SUPABASE_URL: "" },
    { ...configured, SUPABASE_URL: "not-a-url" },
    { ...configured, SUPABASE_URL: "http://remote.example" },
    {
      ...configured,
      SUPABASE_URL: "https://user:password@fixture.supabase.co",
    },
    { ...configured, SUPABASE_PUBLISHABLE_KEY: configured.SUPABASE_SECRET_KEY },
    { ...configured, SUPABASE_PUBLISHABLE_KEY: legacyServiceKey },
    { ...configured, SUPABASE_PUBLISHABLE_KEY: "random-value" },
  ];
  for (const env of invalid)
    await withServer(env, async (base) => {
      const response = await fetch(`${base}/api/config`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "Service is not configured yet.",
      });
    });
});

test("legacy anon keys remain supported without accepting privileged JWT roles", async () => {
  const key = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`;
  await withServer(
    { ...configured, SUPABASE_PUBLISHABLE_KEY: key },
    async (base) => {
      const response = await fetch(`${base}/api/config`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).supabasePublishableKey, key);
    },
  );
});

test("private source, keys and attachment paths cannot be downloaded", async () => {
  await withServer(configured, async (base) => {
    for (const pathname of [
      "/.env",
      "/Files/.env",
      "/.git/config",
      "/server.js",
      "/package.json",
      "/docs/00-README.md",
    ]) {
      const response = await fetch(`${base}${pathname}`);
      assert.equal(response.status, 404, pathname);
      assert.ok(
        !(await response.text()).includes(configured.SUPABASE_SECRET_KEY),
      );
    }
  });
});

test("Master entry resolves without exposing a link on the public page", async () => {
  await withServer(configured, async (base) => {
    const home = await fetch(base);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.ok(html.includes("Webnox OS"));
    assert.ok(!html.includes("/master-login"));
    for (const pathname of ["/master-login", "/master-login.html"]) {
      const response = await fetch(`${base}${pathname}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
      assert.match(
        await response.text(),
        /name="robots" content="noindex, nofollow"/,
      );
    }
  });
});

test("protected APIs require authentication; unknown APIs stay neutral", async () => {
  await withServer(configured, async (base) => {
    for (const pathname of ["/api/members", "/api/master/workspaces"]) {
      const response = await fetch(`${base}${pathname}`);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), {
        error: "Please sign in again.",
      });
    }
    const response = await fetch(`${base}/api/unknown`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Not found." });
  });
});
