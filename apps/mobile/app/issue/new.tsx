import { useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { type IssueCategory, type IssueSeverity } from "@wyre/api";
import { useApi, useUser } from "@/store";
import { PhotoStrip } from "@/photos";
import { Button, Card, Chips, Field, Input, P, Screen } from "@/ui";
import { SEV } from "@/rows";
const CATS: IssueCategory[] = ["electrical", "mechanical", "performance", "data", "safety", "client", "other"];
export default function NewIssue() {
  const api = useApi(); const user = useUser(); const router = useRouter();
  const projects = api.listProjects(user.id).filter((p) => api.can(user.id, "issue.create", p.id));
  const [projectId, setProjectId] = useState<string | null>(projects.length === 1 ? projects[0].id : null);
  const [category, setCategory] = useState<IssueCategory | null>(null); const [severity, setSeverity] = useState<IssueSeverity | null>(null);
  const [title, setTitle] = useState(""); const [desc, setDesc] = useState(""); const [assetQ, setAssetQ] = useState(""); const [assetId, setAssetId] = useState<string | null>(null); const [snag, setSnag] = useState<"no" | "yes">("no");
  const [photos, setPhotos] = useState<string[]>([]);
  const assets = projectId && assetQ.length >= 2 ? api.listAssets({ projectId, status: "installed" }).filter((a) => a.serial.toLowerCase().includes(assetQ.toLowerCase())).slice(0, 5) : [];
  const submit = () => {
    if (!projectId || !category || !severity) { Alert.alert("Missing", "Choose project, category and severity"); return; }
    try { const i = api.raiseIssue(user.id, projectId, { category, severity, title, description: desc, assetId: assetId ?? undefined, beforeAttachmentIds: photos, isSnag: snag === "yes" }); router.replace(`/issue/${i.id}`); }
    catch (e) { Alert.alert("Could not raise issue", (e as Error).message); }
  };
  return <Screen>
    <Field label="Project"><Chips options={projects.map((p) => ({ value: p.id, label: p.code }))} value={projectId} onChange={(v) => { setProjectId(v); setAssetId(null); }} /></Field>
    <Field label="Severity" hint="SLA: critical 24 h · high 72 h · medium 7 d · low 30 d"><Chips options={(["critical", "high", "medium", "low"] as IssueSeverity[]).map((s) => ({ value: s, label: s, tone: SEV[s] }))} value={severity} onChange={setSeverity} /></Field>
    <Field label="Category"><Chips options={CATS.map((c) => ({ value: c, label: c }))} value={category} onChange={setCategory} /></Field>
    <Field label="Title"><Input value={title} onChangeText={setTitle} placeholder="What is wrong, in one line" /></Field>
    <Field label="Description"><Input value={desc} onChangeText={setDesc} multiline placeholder="What you saw, when, any readings" /></Field>
    <Field label="Affected asset (optional)" hint="Type part of a serial number"><Input value={assetQ} onChangeText={(t) => { setAssetQ(t); setAssetId(null); }} placeholder="e.g. DBAT-01" autoCapitalize="characters" />
      {assets.map((a) => <Card key={a.id} onPress={() => { setAssetId(a.id); setAssetQ(a.serial); }} style={{ padding: 10 }}><P mono>{a.serial}</P><P small tone="muted">{a.make} {a.model}</P></Card>)}
      {assetId && <P small tone="success">✓ linked</P>}</Field>
    <Field label="Snag (defects-liability item)?"><Chips options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes — snag list" }]} value={snag} onChange={setSnag} /></Field>
    <Field label="Before photo (required)"><PhotoStrip projectId={projectId ?? ""} ids={photos} onChange={setPhotos} caption={`Before — ${title || "issue"}`} /></Field>
    <Button label="Raise issue" onPress={submit} block />
    <P small tone="faint">Raised issues are visible immediately and flagged until a PM or lead engineer checks the report.</P>
  </Screen>;
}
