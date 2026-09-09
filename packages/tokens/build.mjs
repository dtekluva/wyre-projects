// tokens.json → dist/tokens.css (web, --ns-* vars) + dist/tokens.ts (native, flat object)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const t = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));
mkdirSync(join(here, "dist"), { recursive: true });

const varName = (group, key) => `--ns-${group}${key === "" ? "" : "-" + key}`;
const refRe = /^\{([a-z-]+)\.([a-z0-9-]+)\}$/i;

// primitives
const prim = [];
const primFlat = {};
for (const [group, vals] of Object.entries(t.primitive)) {
  for (const [key, val] of Object.entries(vals)) {
    prim.push(`  ${varName(group, key)}: ${val};`);
    primFlat[`${group}${key === "" ? "" : "." + key}`] = val;
  }
}

const toCss = (v) => { const m = v.match(refRe); return m ? `var(${varName(m[1], m[2])})` : v; };
const toRaw = (v) => { const m = v.match(refRe); return m ? primFlat[`${m[1]}.${m[2]}`] : v; };

const sem = (theme) => Object.entries(t.semantic[theme]).map(([k, v]) => `  --ns-color-${k}: ${toCss(v)};`).join("\n");

const css = `/* GENERATED from packages/tokens/tokens.json — do not edit by hand.
   ${t.$meta.name}. ${t.$meta.basis}.
   Brand: purple ${t.$meta.brand.purple} · yellow ${t.$meta.brand.yellow}. ${t.$meta.rule} */

:root {
${prim.join("\n")}

  /* Semantic — LIGHT (default) */
${sem("light")}

  --ns-focus-ring: 0 0 0 var(--ns-focus-ring-offset) var(--ns-color-surface),
                   0 0 0 calc(var(--ns-focus-ring-offset) + var(--ns-focus-ring-width)) var(--ns-color-border-focus);
}

:root[data-theme="dark"] {
${sem("dark")}
${Object.entries(t.darkElevation).map(([k, v]) => `  --ns-elevation-${k}: ${v};`).join("\n")}
}

:root[data-theme="presentation"] { --ns-scale: 1.125; }

@media (prefers-reduced-motion: reduce) {
  :root { --ns-duration-fast: 1ms; --ns-duration-normal: 1ms; --ns-duration-slow: 1ms; }
}
`;
writeFileSync(join(here, "dist", "tokens.css"), css);

// native / TS
const themes = {};
for (const theme of Object.keys(t.semantic)) {
  themes[theme] = Object.fromEntries(Object.entries(t.semantic[theme]).map(([k, v]) => [k, toRaw(v)]));
}
const ts = `// GENERATED from packages/tokens/tokens.json — do not edit by hand.
export const brand = ${JSON.stringify(t.$meta.brand, null, 2)} as const;
export const primitive = ${JSON.stringify(t.primitive, null, 2)} as const;
export const color = ${JSON.stringify(themes, null, 2)} as const;
export type ThemeName = keyof typeof color;
export type ColorToken = keyof typeof color.light;
`;
writeFileSync(join(here, "dist", "tokens.ts"), ts);
console.log("tokens: wrote dist/tokens.css and dist/tokens.ts");
