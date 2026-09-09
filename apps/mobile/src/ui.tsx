import { type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { T, toneColors, type Tone } from "./theme";

export const Screen = ({ children, scroll = true, pad = true }: { children: ReactNode; scroll?: boolean; pad?: boolean }) => (
  <SafeAreaView style={s.safe} edges={["bottom", "left", "right"]}>
    {scroll ? <ScrollView contentContainerStyle={[pad && s.pad, { gap: T.space.md }]} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={[s.fill, pad && s.pad]}>{children}</View>}
  </SafeAreaView>
);
export const H1 = ({ children }: { children: ReactNode }) => <Text style={s.h1}>{children}</Text>;
export const H2 = ({ children }: { children: ReactNode }) => <Text style={s.h2}>{children}</Text>;
export const P = ({ children, tone, small, mono, bold, style }: { children: ReactNode; tone?: "muted" | "faint" | "danger" | "success"; small?: boolean; mono?: boolean; bold?: boolean; style?: object }) => (
  <Text style={[s.p, small && s.small, mono && s.mono, bold && s.bold, tone === "muted" && { color: T.color.text2 }, tone === "faint" && { color: T.color.text3 }, tone === "danger" && { color: T.color.dangerText }, tone === "success" && { color: T.color.successText }, style]}>{children}</Text>
);
export const Card = ({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) =>
  onPress ? <Pressable onPress={onPress} style={({ pressed }) => [s.card, style, pressed && { backgroundColor: T.color.surfaceSubtle }]}>{children}</Pressable> : <View style={[s.card, style]}>{children}</View>;
export const Row = ({ children, style, wrap }: { children: ReactNode; style?: ViewStyle; wrap?: boolean }) => <View style={[s.row, wrap && { flexWrap: "wrap" }, style]}>{children}</View>;
export const Badge = ({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) => { const c = toneColors(tone); return <View style={[s.badge, { backgroundColor: c.bg }]}><Text style={[s.badgeText, { color: c.fg }]}>{children}</Text></View>; };
export const Button = ({ label, onPress, kind = "primary", disabled, block }: { label: string; onPress: () => void; kind?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean; block?: boolean }) => (
  <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [s.btn, kind === "primary" && { backgroundColor: T.color.primary }, kind === "secondary" && { backgroundColor: T.color.surface, borderWidth: 1, borderColor: T.color.borderStrong },
    kind === "ghost" && { backgroundColor: "transparent" }, kind === "danger" && { backgroundColor: T.color.danger }, disabled && { opacity: 0.4 }, pressed && { opacity: 0.8 }, block && { alignSelf: "stretch" }]}>
    <Text style={[s.btnText, (kind === "secondary" || kind === "ghost") && { color: T.color.primary }]}>{label}</Text>
  </Pressable>
);
export const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => <View style={{ gap: 6 }}><Text style={s.label}>{label}</Text>{children}{hint ? <Text style={[s.small, { color: T.color.text3 }]}>{hint}</Text> : null}</View>;
export const Input = (props: TextInputProps) => <TextInput placeholderTextColor={T.color.text3} {...props} style={[s.input, props.multiline && { minHeight: 90, textAlignVertical: "top" }, props.style]} />;
export function Chips<V extends string>({ options, value, onChange }: { options: { value: V; label: string; tone?: Tone }[]; value: V | null; onChange: (v: V) => void }) {
  return <Row wrap style={{ gap: 8 }}>{options.map((o) => { const on = o.value === value; const c = toneColors(o.tone ?? "primary");
    return <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.chip, on ? { backgroundColor: c.bg, borderColor: c.fg } : null]}><Text style={[s.chipText, on && { color: c.fg, fontWeight: "600" }]}>{o.label}</Text></Pressable>; })}</Row>;
}
export const Empty = ({ title, hint }: { title: string; hint?: string }) => <View style={s.empty}><Text style={[s.p, s.bold]}>{title}</Text>{hint ? <Text style={[s.small, { color: T.color.text3, textAlign: "center" }]}>{hint}</Text> : null}</View>;
export const Divider = () => <View style={{ height: 1, backgroundColor: T.color.border }} />;
export const KV = ({ k, v }: { k: string; v: ReactNode }) => <Row style={{ justifyContent: "space-between", gap: 12 }}><Text style={[s.small, { color: T.color.text3 }]}>{k}</Text><Text style={[s.p, { flexShrink: 1, textAlign: "right" }]}>{v}</Text></Row>;

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.color.canvas }, fill: { flex: 1 }, pad: { padding: T.space.lg, paddingBottom: 40 },
  h1: { fontSize: T.font.page, fontWeight: "800", color: T.color.text, letterSpacing: -0.3 }, h2: { fontSize: T.font.title, fontWeight: "700", color: T.color.text },
  p: { fontSize: T.font.body, color: T.color.text, lineHeight: 21 }, small: { fontSize: T.font.caption, lineHeight: 18 }, mono: { fontVariant: ["tabular-nums"] }, bold: { fontWeight: "600" },
  card: { backgroundColor: T.color.surface, borderRadius: T.radius.lg, borderWidth: 1, borderColor: T.color.border, padding: T.space.lg, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: T.radius.full, alignSelf: "flex-start" }, badgeText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  btn: { minHeight: T.touch, paddingHorizontal: 18, borderRadius: T.radius.md, alignItems: "center", justifyContent: "center" }, btnText: { color: "#fff", fontWeight: "700", fontSize: T.font.body },
  label: { fontSize: T.font.label, fontWeight: "700", color: T.color.text2, textTransform: "uppercase", letterSpacing: 0.5 },
  input: { minHeight: T.touch, borderWidth: 1, borderColor: T.color.borderStrong, borderRadius: T.radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: T.font.body, color: T.color.text, backgroundColor: T.color.surface },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: T.radius.full, borderWidth: 1, borderColor: T.color.border, backgroundColor: T.color.surface, minHeight: 36 }, chipText: { fontSize: T.font.caption, color: T.color.text2 },
  empty: { padding: 24, alignItems: "center", gap: 4, borderRadius: T.radius.lg, borderWidth: 1, borderStyle: "dashed", borderColor: T.color.border },
});
