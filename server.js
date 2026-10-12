import express from "express";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const publicDirectory = fileURLToPath(new URL("./public/", import.meta.url));

function browserConfig(env) {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;

  try {
    const parsed = new URL(url);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:"))
      return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      return null;
    if (parsed.pathname !== "/") return null;
  } catch {
    return null;
  }

  // Never release a server key, even if it is pasted into the public variable.
  if (key === env.SUPABASE_SECRET_KEY?.trim()) return null;
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    const parts = key.split(".");
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8"),
      );
      if (payload.role !== "anon") return null;
    } catch {
      return null;
    }
  }

  return { supabaseUrl: url.replace(/\/$/, ""), supabasePublishableKey: key };
}

export function createApp(env = process.env, clientFactory = createClient) {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  app.use(express.json({ limit: "128kb" }));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const config = browserConfig(env);
  const service = () => {
    if (!config || !env.SUPABASE_SECRET_KEY)
      throw Object.assign(new Error("Service is not configured yet."), {
        status: 503,
      });
    return clientFactory(config.supabaseUrl, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  };
  const userClient = (token) =>
    clientFactory(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  const fail = (message, status = 400) =>
    Object.assign(new Error(message), { status });
  async function requireAuth(req, res, next) {
    const token = /^Bearer ([^\s]+)$/.exec(
      req.headers.authorization || "",
    )?.[1];
    if (!token) return res.status(401).json({ error: "Please sign in again." });
    try {
      const { data, error } = await service().auth.getUser(token);
      if (error || !data?.user)
        return res.status(401).json({ error: "Please sign in again." });
      req.db = userClient(token);
      const context = await req.db.rpc("boot_context");
      if (
        context.error ||
        !context.data?.profile ||
        context.data.profile.id !== data.user.id ||
        context.data.profile.status !== "active"
      )
        return res.status(403).json({ error: "Access is not permitted." });
      req.context = context.data;
      if (
        !context.data.profile.is_master &&
        (!context.data.workspace ||
          !["active", "trial"].includes(context.data.workspace.status))
      )
        return res
          .status(403)
          .json({ error: "Your workspace is unavailable." });
      next();
    } catch (error) {
      next(error);
    }
  }
  function masterOnly(req, res, next) {
    if (!req.context.profile.is_master)
      return res.status(403).json({ error: "Access is not permitted." });
    next();
  }
  function adminOnly(req, res, next) {
    if (
      req.context.profile.is_master ||
      req.context.profile.account_type !== "admin"
    )
      return res.status(403).json({ error: "Access is not permitted." });
    next();
  }
  async function rpc(db, name, payload) {
    const result = await db.rpc(name, payload);
    if (result.error) {
      if (result.error.code === "23505")
        throw fail(
          "This email, workspace slug or short code is already in use. Choose another.",
        );
      throw fail(result.error.message || "Unable to save your changes.");
    }
    return result.data;
  }
  function email(value) {
    const result = String(value || "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) || result.length > 254)
      throw fail("Enter a valid email address.");
    return result;
  }
  function textField(value, title, max = 120) {
    if (typeof value !== "string" || !value.trim() || value.length > max)
      throw fail(`Enter a valid ${title}.`);
    return value.trim();
  }
  function siteUrl() {
    try {
      const site = new URL(env.SITE_URL);
      if (
        site.protocol !== "https:" ||
        site.username ||
        site.password ||
        site.pathname !== "/" ||
        site.search ||
        site.hash
      )
        throw new Error();
      return site.origin;
    } catch {
      throw fail("Invitation links are not configured yet.", 503);
    }
  }
  async function createIdentity(db, identity, created) {
    // A random unknown password creates no usable password credential for an operator.
    // The recipient chooses their password using the generated recovery link.
    const result = await db.auth.admin.createUser({
      email: email(identity.email),
      email_confirm: true,
      password: randomBytes(36).toString("base64url"),
      user_metadata: { name: identity.name },
    });
    if (result.error)
      throw fail(
        /already|registered/i.test(result.error.message)
          ? "This email already has an account. Use another email."
          : "Unable to create the account. Please try again.",
      );
    created.push(result.data.user.id);
    return result.data.user;
  }
  async function invitation(db, identity, slug) {
    const link = await db.auth.admin.generateLink({
      type: "recovery",
      email: identity.email,
      options: { redirectTo: `${siteUrl()}/set-password.html` },
    });
    if (link.error || !link.data?.properties?.hashed_token)
      throw fail("Unable to prepare a password link. Please try again.");
    const url = new URL("/set-password.html", siteUrl());
    url.searchParams.set("token_hash", link.data.properties.hashed_token);
    url.searchParams.set("type", "recovery");
    if (slug) url.searchParams.set("w", slug);
    return url.toString();
  }
  async function cleanupUnprovisioned(db, ids) {
    for (const id of ids) {
      const profile = await db
        .from("profiles")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      // A timeout after a committed RPC is not evidence that an account is orphaned.
      if (!profile.error && !profile.data) await db.auth.admin.deleteUser(id);
    }
  }

  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
    });
    next();
  });

  app.get("/api/config", (_req, res) => {
    res.set("Cache-Control", "no-store");
    const config = browserConfig(env);
    if (!config)
      return res.status(503).json({ error: "Service is not configured yet." });
    return res.json(config);
  });

  app.post("/api/public/workspace-brand", async (req, res, next) => {
    const started = Date.now();
    res.set("Cache-Control", "no-store");
    try {
      const db = service();
      // Vercel overwrites this header. Local deployments use the socket address.
      const ip = env.VERCEL
        ? String(
            req.headers["x-vercel-forwarded-for"] || req.socket.remoteAddress,
          ).split(",")[0]
        : req.socket.remoteAddress;
      const digest = createHmac("sha256", env.SUPABASE_SECRET_KEY)
        .update(String(ip))
        .digest("hex");
      const allowed = await db.rpc("check_public_rate_limit", {
        bucket_key: `brand:${digest}`,
        max_hits: 10,
      });
      if (allowed.error) throw fail("Service is temporarily unavailable.", 503);
      if (!allowed.data)
        return res
          .status(429)
          .set("Retry-After", "60")
          .json({ error: "Please wait a minute and try again." });
      let brand = {};
      if (typeof req.body?.email === "string" && req.body.email.length <= 254) {
        const { data } = await db
          .from("profiles")
          .select("workspace_id")
          .eq("email", req.body.email.trim().toLowerCase())
          .eq("status", "active")
          .eq("is_master", false)
          .maybeSingle();
        if (data?.workspace_id) {
          const result = await db
            .from("workspaces")
            .select("name,logo_url,slug")
            .eq("id", data.workspace_id)
            .in("status", ["active", "trial"])
            .maybeSingle();
          if (result.data) brand = result.data;
        }
      } else if (
        typeof req.body?.slug === "string" &&
        /^[a-z0-9-]{2,64}$/.test(req.body.slug)
      ) {
        const result = await db
          .from("workspaces")
          .select("name,logo_url,slug")
          .eq("slug", req.body.slug)
          .in("status", ["active", "trial"])
          .maybeSingle();
        if (result.data) brand = result.data;
      }
      if (
        brand.logo_url?.match(
          /^w[0-9a-f-]{36}\/(logo|[0-9a-f-]{36})\.(png|jpe?g|webp|svg)$/,
        )
      ) {
        brand.logo_url = `${config.supabaseUrl}/storage/v1/object/public/brand/${brand.logo_url}`;
      }
      await delay(Math.max(0, 250 - (Date.now() - started)));
      res.json(brand);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/public/form", async (req, res, next) => {
    try {
      const token = String(req.query.token || "");
      if (!/^[a-f0-9]{64}$/.test(token))
        throw fail("This form is unavailable.", 404);
      const { data, error } = await service()
        .from("workspaces")
        .select("name,slug")
        .eq("public_form_token", token)
        .in("status", ["active", "trial"])
        .maybeSingle();
      if (error) throw error;
      if (!data) throw fail("This form is unavailable.", 404);
      res.json(data);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/public/lead", async (req, res, next) => {
    try {
      const p = req.body || {},
        token = String(p.token || "");
      if (!/^[a-f0-9]{64}$/.test(token))
        throw fail("This form is unavailable.", 404);
      const db = service(),
        address = env.VERCEL
          ? String(
              req.headers["x-vercel-forwarded-for"] || req.socket.remoteAddress,
            )
          : String(req.socket.remoteAddress);
      const key =
        "lead:" +
        createHmac("sha256", env.SUPABASE_SECRET_KEY)
          .update(address)
          .digest("hex");
      const limited = await db.rpc("check_public_rate_limit", {
        bucket_key: key,
        max_hits: 5,
      });
      if (limited.error) throw limited.error;
      if (!limited.data)
        return res
          .status(429)
          .set("Retry-After", "60")
          .json({ error: "Please wait a minute before trying again." });
      if (p.fax) return res.status(201).json({ received: true });
      const payload = {};
      for (const name of [
        "name",
        "company",
        "email",
        "phone",
        "website",
        "country",
        "niche",
        "service",
        "notes",
      ]) {
        if (
          typeof p[name] !== "string" ||
          p[name].length > (name === "notes" ? 5000 : 240)
        )
          throw fail("Please check your form details.");
        payload[name] = p[name].trim();
      }
      if (!payload.company) throw fail("Company is required.");
      if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email))
        throw fail("Please enter a valid email.");
      if (!/^[A-Z]{3}$/.test(p.currency)) throw fail("Choose a currency.");
      payload.currency = p.currency;
      payload.budget = Number(p.budget || 0);
      if (
        !Number.isFinite(payload.budget) ||
        payload.budget < 0 ||
        payload.budget > 999999999999
      )
        throw fail("Enter a valid budget.");
      const result = await db.rpc("public_lead_submit", {
        form_token: token,
        payload,
      });
      if (result.error)
        throw fail(
          "This form is unavailable. Please contact the business.",
          400,
        );
      res.status(201).json({ received: true });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api/master", requireAuth, masterOnly);
  const rateCache = new Map();
  app.get("/api/fx", requireAuth, async (req, res, next) => {
    try {
      const from = String(req.query.from || ""),
        to = String(req.query.to || "");
      if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to))
        throw fail("Choose valid currencies.");
      if (from === to)
        return res.json({
          rate: 1,
          updated_at: new Date().toISOString(),
          provider: null,
        });
      let entry = rateCache.get(from);
      if (!entry || entry.expires < Date.now()) {
        const response = await fetch(
          `https://open.er-api.com/v6/latest/${from}`,
          { signal: AbortSignal.timeout(6000) },
        );
        const data = await response.json();
        if (!response.ok || data.result !== "success" || !data.rates)
          throw fail(
            "Rate unavailable. Enter your conversion rate manually.",
            503,
          );
        entry = {
          rates: data.rates,
          updated_at: new Date(data.time_last_update_unix * 1000).toISOString(),
          expires: Date.now() + 3600000,
        };
        rateCache.set(from, entry);
      }
      const rate = entry.rates[to];
      if (!Number.isFinite(rate) || rate <= 0)
        throw fail(
          "Rate unavailable. Enter your conversion rate manually.",
          503,
        );
      res.json({
        rate,
        updated_at: entry.updated_at,
        provider: "ExchangeRate-API",
      });
    } catch (error) {
      next(
        error.status
          ? error
          : fail("Rate unavailable. Enter your conversion rate manually.", 503),
      );
    }
  });
  app.get("/api/master/workspaces", async (req, res, next) => {
    try {
      res.json(await rpc(req.db, "master_workspace_list", {}));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/master/workspaces", async (req, res, next) => {
    let db;
    const created = [];
    try {
      siteUrl();
      const p = req.body || {};
      p.name = textField(p.name, "business name");
      p.slug = textField(p.slug, "workspace slug", 64);
      p.short_code = textField(p.short_code, "short code", 4);
      p.admin_name = textField(p.admin_name, "admin name");
      p.manager_name = textField(p.manager_name, "manager name");
      p.admin_email = email(p.admin_email);
      p.manager_email = email(p.manager_email);
      if (p.admin_email === p.manager_email)
        throw fail("Admin and manager need separate email addresses.");
      if (
        !["master_project", "rented"].includes(p.type) ||
        !Array.isArray(p.roles)
      )
        throw fail("Choose a space type and roles.");
      if (
        p.type === "rented" &&
        (!["trial_7", "trial_14", "monthly", "quarterly", "yearly"].includes(
          p.cycle,
        ) ||
          !Number.isFinite(Number(p.amount)) ||
          Number(p.amount) < 0 ||
          !(Number(p.fx_rate) > 0))
      )
        throw fail("Complete the rent plan, amount and exchange rate.");
      db = service();
      const admin = await createIdentity(
        db,
        { name: p.admin_name, email: p.admin_email },
        created,
      );
      const manager = await createIdentity(
        db,
        { name: p.manager_name, email: p.manager_email },
        created,
      );
      const normalSlug = p.slug
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const invites = await Promise.all([
        invitation(db, admin, normalSlug),
        invitation(db, manager, normalSlug),
      ]);
      const workspace = await rpc(req.db, "master_create_workspace", {
        payload: { ...p, admin_id: admin.id, manager_id: manager.id },
      });
      res.status(201).json({
        workspace,
        invites: [
          {
            name: p.admin_name,
            email: admin.email,
            role: "Admin",
            url: invites[0],
          },
          {
            name: p.manager_name,
            email: manager.email,
            role: "Manager",
            url: invites[1],
          },
        ],
      });
    } catch (error) {
      if (db) await cleanupUnprovisioned(db, created).catch(() => {});
      next(error);
    }
  });
  app.use("/api/members", requireAuth, adminOnly);
  app.post("/api/members", async (req, res, next) => {
    let db;
    const created = [];
    try {
      siteUrl();
      const p = req.body || {};
      p.name = textField(p.name, "name");
      p.email = email(p.email);
      if (!Array.isArray(p.roles) || p.roles.length === 0)
        throw fail("Choose at least one role.");
      db = service();
      const user = await createIdentity(db, p, created);
      const url = await invitation(db, user, req.context.workspace.slug);
      const member = await rpc(req.db, "admin_add_member", {
        target: user.id,
        payload: p,
      });
      res.status(201).json({ member, url });
    } catch (error) {
      if (db) await cleanupUnprovisioned(db, created).catch(() => {});
      next(error);
    }
  });
  app.post("/api/members/:id/link", async (req, res, next) => {
    try {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id))
        throw fail("Member not found.", 404);
      const result = await req.db
        .from("profiles")
        .select("id,email,status")
        .eq("id", req.params.id)
        .eq("workspace_id", req.context.workspace.id)
        .maybeSingle();
      if (result.error || !result.data || result.data.status !== "active")
        throw fail("Member not found.", 404);
      res.json({
        url: await invitation(
          service(),
          result.data,
          req.context.workspace.slug,
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", (_req, res) => {
    res
      .set("Cache-Control", "no-store")
      .status(404)
      .json({ error: "Not found." });
  });

  app.get(["/master-login", "/master-login.html"], (_req, res) => {
    res.set({
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "no-store",
    });
    res.sendFile(path.join(publicDirectory, "master-login.html"));
  });

  // Only public/ is served. Source files, docs, attachments and .env stay private.
  app.use(
    express.static(publicDirectory, {
      dotfiles: "deny",
      etag: false,
      setHeaders(res, file) {
        if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
      },
    }),
  );
  app.use((_req, res) => res.status(404).type("text").send("Page not found."));
  app.use((error, _req, res, _next) => {
    if (!res.headersSent)
      res
        .set("Cache-Control", "no-store")
        .status(error.status || 500)
        .json({
          error: error.status
            ? error.message
            : "Unable to complete the request.",
        });
  });
  return app;
}

const app = createApp();
export default app;

// Vercel imports the default export; direct Node execution starts the local server.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () =>
    console.log(`Webnox OS is listening on port ${port}.`),
  );
}
