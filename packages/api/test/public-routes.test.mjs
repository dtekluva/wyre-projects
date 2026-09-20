/**
 * Invite and reset links are followed by people with no session.
 *
 * AuthProvider replaces the entire app with the sign-in card when signed out. Without an explicit
 * exception, every invite email dead-ends on a login form the recipient cannot get past — which is
 * exactly what shipped, silently, because the edit that added the exception never applied.
 */
import { readFileSync } from "node:fs";

const auth = readFileSync("apps/web/src/lib/auth.tsx", "utf8");
const app = readFileSync("apps/web/src/App.tsx", "utf8");

const fails = [];
const gate = auth.match(/if \(remote && status === "out"[^\n]*/)?.[0] ?? "";
if (!gate) fails.push("could not find the signed-out gate in auth.tsx");
else if (!/&&\s*!\w+/.test(gate)) fails.push(`the signed-out gate has no exception for public paths:\n    ${gate.trim()}`);

for (const p of ["invite", "reset", "forgot"]) {
  if (!new RegExp(`path="${p}`).test(app)) fails.push(`App.tsx has no route for /${p}`);
  if (!new RegExp(`\\b${p}\\b`).test(auth)) fails.push(`auth.tsx does not let /${p} past the sign-in card`);
}

if (fails.length) { console.log("FAIL:"); for (const f of fails) console.log(`  ${f}`); process.exit(1); }
console.log("ok  : /invite, /reset and /forgot reach the router when signed out");
