/**
 * The wire between the two sides.
 *
 * A MockApi method RemoteApi never wraps applies locally and is never sent: the UI looks like it worked,
 * then the change vanishes at the next snapshot. A wrapped one that sends the wrong body shape fails at
 * runtime with "'input' object is required". Neither is visible to a type checker, because the wire is
 * untyped JSON — both shipped to production before this existed.
 */
import { readFileSync } from "node:fs";

const py = readFileSync("backend/tracker/commands.py", "utf8");
const remote = readFileSync("packages/api/src/remote.ts", "utf8");

const commands = new Set([...py.matchAll(/"([a-zA-Z]+)": lambda/g)].map((m) => m[1]));
const needsInput = new Set([...py.matchAll(/"([a-zA-Z]+)": lambda[^\n]*_in\(d\)/g)].map((m) => m[1]));

// Each wrap's body is everything up to the next wrap( or the end of wrapMutations.
const sends = new Map();
const chunks = remote.split(/wrap\(/).slice(1);
for (const chunk of chunks) {
  const loop = chunk.match(/^const n of \[([^\]]+)\]/);
  const names = loop
    ? [...loop[1].matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1])
    : (chunk.match(/^"([a-zA-Z]+)"/) ? [chunk.match(/^"([a-zA-Z]+)"/)[1]] : []);
  const body = chunk.split("\n").slice(0, 3).join("\n");
  for (const n of names) sends.set(n, /\binput:/.test(body));
}
// the bulk loops are written as `for (const n of [...]) wrap(n, ...)`, so pick their names up too
for (const loop of remote.matchAll(/for \(const n of \[([^\]]+)\]\)\s*wrap\(n,([^\n]*)/g))
  for (const m of loop[1].matchAll(/"([a-zA-Z]+)"/g)) sends.set(m[1], /\binput:/.test(loop[2]));

const missing = [...commands].filter((c) => !sends.has(c)).sort();
const wrongShape = [...needsInput].filter((c) => sends.has(c) && !sends.get(c)).sort();

let bad = false;
if (missing.length) {
  bad = true;
  console.log(`FAIL: ${missing.length} backend command(s) the UI can never send:`);
  for (const c of missing) console.log(`  ${c}`);
}
if (wrongShape.length) {
  bad = true;
  console.log(`FAIL: ${wrongShape.length} command(s) send a flat body where the server reads _in(d):`);
  for (const c of wrongShape) console.log(`  ${c}  — needs body: { input: ... }`);
}
if (bad) process.exit(1);
console.log(`ok  : ${commands.size} commands wired, ${needsInput.size} input-shaped ones correct`);
