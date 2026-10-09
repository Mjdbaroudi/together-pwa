import fs from "node:fs";
import { spawnSync } from "node:child_process";
import webpush from "web-push";

const envPath = ".env.local";
const rotate = process.argv.includes("--rotate");
const projectLink = ".vercel/project.json";

function parseEnv(text) {
  const result = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    result.set(trimmed.slice(0, index), trimmed.slice(index + 1));
  }
  return result;
}

function setEnv(text, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(text)) return text.replace(pattern, line);
  return `${text.trimEnd()}${text.trim() ? "\n" : ""}${line}\n`;
}

function runVercel(args, { input, quiet = false } = {}) {
  const windows = process.platform === "win32";
  const command = windows ? "cmd.exe" : "vercel";
  const commandArgs = windows ? ["/d", "/s", "/c", "vercel", ...args] : args;
  const result = spawnSync(command, commandArgs, {
    input: input === undefined ? undefined : `${input}\n`,
    encoding: "utf8",
    stdio: input === undefined ? (quiet ? "ignore" : "inherit") : ["pipe", quiet ? "ignore" : "inherit", quiet ? "ignore" : "inherit"],
  });
  return result.status === 0;
}

function setVercelEnv(name, value, sensitive = false) {
  const args = ["env", "add", name, "production", "--force"];
  if (sensitive) args.push("--sensitive");
  if (!runVercel(args, { input: value })) {
    throw new Error(`Could not update ${name} on Vercel Production.`);
  }
}

if (!fs.existsSync(projectLink)) {
  throw new Error("This folder is not linked to Vercel. Run `vercel link` once, then retry.");
}
if (!runVercel(["whoami"])) {
  throw new Error("Vercel login is not active. Run `vercel login`, then retry.");
}

const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const current = parseEnv(existing);
let publicKey = current.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY") || "";
let privateKey = current.get("VAPID_PRIVATE_KEY") || "";
const subject = current.get("VAPID_SUBJECT") || "mailto:together@example.com";

if (rotate || !publicKey || !privateKey) {
  const generated = webpush.generateVAPIDKeys();
  publicKey = generated.publicKey;
  privateKey = generated.privateKey;
  console.log(rotate ? "Rotated VAPID keys." : "Generated missing VAPID keys.");
} else {
  console.log("Reusing the existing VAPID keys so current device subscriptions remain valid.");
}

let next = existing;
next = setEnv(next, "NEXT_PUBLIC_VAPID_PUBLIC_KEY", publicKey);
next = setEnv(next, "VAPID_PRIVATE_KEY", privateKey);
next = setEnv(next, "VAPID_SUBJECT", subject);
fs.writeFileSync(envPath, next, "utf8");

console.log("Updating Vercel Production environment…");
setVercelEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", publicKey, false);
setVercelEnv("VAPID_PRIVATE_KEY", privateKey, true);
setVercelEnv("VAPID_SUBJECT", subject, false);

console.log("Deploying Production so the public VAPID key is built into the PWA…");
if (!runVercel(["--prod", "--yes"])) throw new Error("Vercel deployment failed.");
console.log("Notifications are configured. Existing subscriptions were preserved unless --rotate was used.");
