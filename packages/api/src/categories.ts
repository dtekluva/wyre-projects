import { ASSET_TYPES, TOOL_CATEGORIES, type AssetType } from "./types";

/** What each category is called where a person reads it. */
export const CATEGORY_LABEL: Record<string, string> = {
  panel: "Panels", inverter: "Inverters", battery: "Batteries", meter: "Meters", ct: "CTs", ats: "ATS / changeover",
  cable: "Cable & wire", mounting: "Mounting", other: "Other stock", tool: "Tool", ppe: "PPE", consumable: "Consumables",
};

/** The two things a person is really choosing between: stock that goes out to projects, and kit the team keeps. */
export const CATEGORY_GROUPS: { label: string; categories: readonly AssetType[] }[] = [
  { label: "Project stock", categories: ASSET_TYPES.filter((c) => !TOOL_CATEGORIES.includes(c)) },
  { label: "Team kit \u2014 held by a person", categories: ["tool", "ppe"] },
];

// Names people actually write, in the order they are tried. Tools and PPE come first so "cable tester" is a
// tool and "clamp meter" is not a meter. Every word is matched at a word start (" cable" finds "cables" but
// " vest" does not find "investment"). Mirrors backend/tracker/services/stock.py _CATEGORY_HINTS.
const HINTS: readonly [string, AssetType][] = [
  ["drill", "tool"], ["crimp", "tool"], ["multimeter", "tool"], ["clamp meter", "tool"], ["ladder", "tool"], ["spanner", "tool"], ["wrench", "tool"],
  ["screwdriver", "tool"], ["tool", "tool"], ["torque", "tool"], ["hammer", "tool"], ["plier", "tool"], ["hacksaw", "tool"], ["grinder", "tool"], ["tester", "tool"],
  ["helmet", "ppe"], ["hard hat", "ppe"], ["glove", "ppe"], ["boot", "ppe"], ["harness", "ppe"], ["goggle", "ppe"], ["vest", "ppe"], ["ppe", "ppe"], ["face shield", "ppe"],
  ["inverter", "inverter"], ["battery", "battery"], ["batteries", "battery"], ["panel", "panel"], ["module", "panel"], ["meter", "meter"],
  ["cable", "cable"], ["wire", "cable"], ["wiring", "cable"], ["ats", "ats"], ["changeover", "ats"], ["ct", "ct"],
  ["rail", "mounting"], ["mount", "mounting"], ["bracket", "mounting"],
];

/** Best guess at what a line is from its name alone. A wrong guess costs nothing: the Kind picker shows it and the person corrects it. */
export function guessCategory(name: string): AssetType {
  const low = ` ${(name ?? "").trim().toLowerCase().split(/\s+/).join(" ")} `;
  return HINTS.find(([w]) => low.includes(` ${w}`))?.[1] ?? "other";
}
