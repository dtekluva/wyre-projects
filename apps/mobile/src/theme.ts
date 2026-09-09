// Northstar tokens married with the Wyre brand, mapped for React Native.
import { brand, primitive } from "@wyre/tokens";
const n = primitive.neutral as Record<string, string>;
const p = primitive.purple as Record<string, string>;
const g = (primitive as unknown as { green: Record<string, string> }).green;
const a = (primitive as unknown as { amber: Record<string, string> }).amber;
const r = (primitive as unknown as { red: Record<string, string> }).red;
export const T = {
  color: {
    canvas: n["50"], surface: n["0"], surfaceSubtle: n["100"], border: n["200"], borderStrong: n["300"],
    text: n["900"], text2: n["600"], text3: n["500"], inverse: n["0"],
    primary: brand.purple, primaryDark: p["700"] ?? "#3F2367", primarySubtle: p["50"] ?? "#F3EEFA",
    accent: brand.yellow, nav: "#1A0F2E",
    success: g?.["600"] ?? "#059669", successSubtle: g?.["50"] ?? "#ECFDF5", successText: g?.["700"] ?? "#047857",
    warning: a?.["600"] ?? "#D97706", warningSubtle: a?.["50"] ?? "#FFFBEB", warningText: a?.["700"] ?? "#B45309",
    danger: r?.["600"] ?? "#DC2626", dangerSubtle: r?.["50"] ?? "#FEF2F2", dangerText: r?.["700"] ?? "#B91C1C",
    info: "#2563EB", infoSubtle: "#EFF6FF", infoText: "#1D4ED8",
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 6, md: 10, lg: 14, full: 999 },
  font: { label: 12, caption: 13, body: 15, bodyLg: 17, title: 20, page: 26 },
  touch: 48,
} as const;
export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";
export const toneColors = (t: Tone) => ({
  neutral: { bg: T.color.surfaceSubtle, fg: T.color.text2 }, success: { bg: T.color.successSubtle, fg: T.color.successText },
  warning: { bg: T.color.warningSubtle, fg: T.color.warningText }, danger: { bg: T.color.dangerSubtle, fg: T.color.dangerText },
  info: { bg: T.color.infoSubtle, fg: T.color.infoText }, primary: { bg: T.color.primarySubtle, fg: T.color.primary },
}[t]);
