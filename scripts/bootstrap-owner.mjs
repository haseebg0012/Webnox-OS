// Run only for the owner: node --env-file=.env scripts/bootstrap-owner.mjs --create
// Creates no demo users and sends no email. The private password link stays local.
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
if (!process.argv.includes("--create"))
  throw new Error("Pass --create to provision the platform owner.");
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const email = "haseebg0012@gmail.com";
let owner;
for (let page = 1; !owner; page++) {
  const { data, error } = await db.auth.admin.listUsers({
    page,
    perPage: 1000,
  });
  if (error) throw error;
  owner = data.users.find((u) => u.email?.toLowerCase() === email);
  if (data.users.length < 1000) break;
}
let created = false;
if (!owner) {
  const { data, error } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomBytes(36).toString("base64url"),
    user_metadata: { name: "Haseeb Gul" },
  });
  if (error) throw error;
  owner = data.user;
  created = true;
}
const promotion = await db.rpc("promote_to_master", { email });
if (promotion.error) throw promotion.error;
if (created || !owner.last_sign_in_at || process.argv.includes("--new-link")) {
  const result = await db.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: process.env.SITE_URL + "/set-password.html" },
  });
  if (result.error) throw result.error;
  const link = new URL("/set-password.html", process.env.SITE_URL);
  link.searchParams.set("type", "recovery");
  link.searchParams.set("token_hash", result.data.properties.hashed_token);
  await mkdir("Files", { recursive: true });
  await writeFile(
    "Files/Owner-Setup.html",
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Webnox OS · Owner setup</title><style>body{font:16px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#0b1f3a}a{display:inline-block;background:#1d4ed8;color:white;border-radius:8px;padding:14px 22px;text-decoration:none}p{line-height:1.6;color:#475569}</style><h1>Your Webnox OS account is ready</h1><p>Haseeb, use this private link to choose your password. Press Continue on the page, then enter and confirm your password yourself.</p><a href="${link.toString().replaceAll("&", "&amp;")}">Set my password</a><p>This file contains a private, one-use sign-in link. Keep it to yourself.</p></html>`,
  );
  console.log(
    "Owner provisioned. Private setup link saved to Files/Owner-Setup.html. No email was sent.",
  );
} else
  console.log(
    "Owner already provisioned; existing password and links preserved.",
  );
