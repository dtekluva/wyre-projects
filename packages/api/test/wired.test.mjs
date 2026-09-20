/**
 * Every backend command must be reachable from the browser.
 *
 * A MockApi method that RemoteApi never wraps applies locally and is never sent: the UI looks like it
 * worked, the change survives until the next snapshot, then silently vanishes. Seven commands shipped
 * that way before this existed.
 */
import { readFileSync } from "node:fs";

const commands = new Set([...readFileSync("backend/tracker/commands.py", "utf8").matchAll(/"([a-zA-Z]+)": lambda/g)].map((m) => m[1]));
const remote = readFileSync("packages/api/src/remote.ts", "utf8");
const wrapped = new Set([...remote.matchAll(/wrap\("([a-zA-Z]+)"/g)].map((m) => m[1]));
for (const block of remote.matchAll(/for \(const n of \[([^\]]+)\]/g))
  for (const m of block[1].matchAll(/"([a-zA-Z]+)"/g)) wrapped.add(m[1]);

const missing = [...commands].filter((c) => !wrapped.has(c)).sort();
if (missing.length) {
  console.log(`FAIL: ${missing.length} backend command(s) the UI can never send:`);
  for (const m of missing) console.log(`  ${m}`);
  process.exit(1);
}
console.log(`ok  : all ${commands.size} backend commands are wired to the UI`);
