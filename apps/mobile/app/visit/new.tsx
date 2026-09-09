import { useEffect, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { VISIT_TYPE_LABEL, naira, type VisitType } from "@wyre/api";
import { currentGps } from "@/capture";
import { useApi, useUser } from "@/store";
import { PhotoStrip } from "@/photos";
import { Badge, Button, Card, Chips, Divider, Field, Input, P, Row, Screen } from "@/ui";
import { T } from "@/theme";
type Part = { itemId: string; qty: number; serials: string[] };
export default function NewVisit() {
  const api = useApi(); const user = useUser(); const router = useRouter();
  const projects = api.listProjects(user.id).filter((p) => api.can(user.id, "visit.create", p.id));
  const van = api.listLocations().find((l) => l.type === "vehicle" && l.custodianId === user.id) ?? api.listLocations().find((l) => l.type === "vehicle") ?? api.listLocations()[0];
  const [startedAt] = useState(() => new Date().toISOString()); const [gps, setGps] = useState<{ lat: number; lng: number } | undefined>();
  useEffect(() => { currentGps().then(setGps); }, []);
  const [projectId, setProjectId] = useState<string | null>(projects.length === 1 ? projects[0].id : null);
  const [type, setType] = useState<VisitType | null>(null); const [findings, setFindings] = useState(""); const [actions, setActions] = useState("");
  const [travel, setTravel] = useState(""); const [labour, setLabour] = useState(""); const [photos, setPhotos] = useState<string[]>([]);
  const [parts, setParts] = useState<Part[]>([]); const [signName, setSignName] = useState(""); const [rating, setRating] = useState<"1" | "2" | "3" | "4" | "5" | null>(null); const [signPhoto, setSignPhoto] = useState<string[]>([]);
  const vanItems = api.balances().filter((b) => b.locationId === van.id && b.qtyOnHand > 0).map((b) => api.item(b.itemId));
  const partsCost = parts.reduce((s, p) => s + p.qty * api.wacOf(p.itemId), 0);
  const addPart = (itemId: string) => { if (parts.some((p) => p.itemId === itemId)) return; setParts([...parts, { itemId, qty: api.item(itemId).isSerialised ? 0 : 1, serials: [] }]); };
  const setPart = (itemId: string, patch: Partial<Part>) => setParts(parts.map((p) => (p.itemId === itemId ? { ...p, ...patch } : p)));
  const submit = () => {
    if (!projectId || !type) { Alert.alert("Missing", "Choose project and visit type"); return; }
    try {
      const v = api.logVisit(user.id, projectId, { visitType: type, startedAt, endedAt: new Date().toISOString(), findings, actionsTaken: actions, costTravel: Number(travel) || 0, costLabour: Number(labour) || 0,
        parts: parts.map((p) => ({ itemId: p.itemId, qty: p.qty, serials: p.serials })), locationId: van.id, attachmentIds: photos, gps,
        clientSignoff: signName ? { name: signName, rating: rating ? Number(rating) : undefined, signatureAttachmentId: signPhoto[0] } : undefined });
      router.replace(`/visit/${v.id}`);
    } catch (e) { Alert.alert("Could not log visit", (e as Error).message); }
  };
  return <Screen>
    <Row style={{ justifyContent: "space-between" }}><P small tone="muted">Started {new Date(startedAt).toLocaleTimeString()}</P><P small tone="faint">{gps ? `📍 ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : "📍 locating…"}</P></Row>
    <Field label="Project"><Chips options={projects.map((p) => ({ value: p.id, label: p.code }))} value={projectId} onChange={setProjectId} /></Field>
    <Field label="Visit type"><Chips options={(Object.keys(VISIT_TYPE_LABEL) as VisitType[]).map((t) => ({ value: t, label: VISIT_TYPE_LABEL[t] }))} value={type} onChange={setType} /></Field>
    <Field label="Findings"><Input value={findings} onChangeText={setFindings} multiline placeholder="What you found" /></Field>
    <Field label="Actions taken"><Input value={actions} onChangeText={setActions} multiline placeholder="What you did" /></Field>
    <Field label={`Parts used from ${van.name}`} hint="Issued at weighted-average cost; checked together with this visit">
      <Row wrap>{vanItems.map((it) => <Pressable key={it.id} onPress={() => addPart(it.id)} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: T.color.border, backgroundColor: parts.some((p) => p.itemId === it.id) ? T.color.primarySubtle : T.color.surface }}><P small>{it.name} · {api.available(it.id, van.id)}</P></Pressable>)}</Row>
      {parts.map((p) => { const it = api.item(p.itemId); const free = api.inStockSerials(it.id, van.id); return <Card key={p.itemId} style={{ padding: 10 }}>
        <Row style={{ justifyContent: "space-between" }}><P bold>{it.name}</P><Button label="✕" kind="ghost" onPress={() => setParts(parts.filter((x) => x.itemId !== p.itemId))} /></Row>
        {it.isSerialised ? <Row wrap>{free.map((s) => { const on = p.serials.includes(s); return <Pressable key={s} onPress={() => { const serials = on ? p.serials.filter((x) => x !== s) : [...p.serials, s]; setPart(p.itemId, { serials, qty: serials.length }); }} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: on ? T.color.primary : T.color.border, backgroundColor: on ? T.color.primarySubtle : T.color.surface }}><P small mono>{s}</P></Pressable>; })}</Row>
          : <Row><Button label="−" kind="secondary" onPress={() => setPart(p.itemId, { qty: Math.max(1, p.qty - 1) })} /><P bold mono>{p.qty} {it.unit}</P><Button label="＋" kind="secondary" onPress={() => setPart(p.itemId, { qty: Math.min(api.available(it.id, van.id), p.qty + 1) })} /><P small tone="muted">@ {naira(api.wacOf(it.id))}</P></Row>}
      </Card>; })}
    </Field>
    <Row><View style={{ flex: 1 }}><Field label="Travel ₦"><Input value={travel} onChangeText={setTravel} keyboardType="numeric" placeholder="0" /></Field></View><View style={{ flex: 1 }}><Field label="Labour ₦"><Input value={labour} onChangeText={setLabour} keyboardType="numeric" placeholder="0" /></Field></View></Row>
    <Card><Row style={{ justifyContent: "space-between" }}><P small tone="muted">Visit cost</P><P bold mono>{naira((Number(travel) || 0) + (Number(labour) || 0) + partsCost)}</P></Row><P small tone="faint">travel + labour + parts {naira(partsCost, true)}</P></Card>
    <Field label="Site photos (required)"><PhotoStrip projectId={projectId ?? ""} ids={photos} onChange={setPhotos} caption={`${type ? VISIT_TYPE_LABEL[type] : "Visit"} — site photo`} /></Field>
    <Divider />
    <Field label="Client sign-off (recorded by you)" hint="Name of the person on site; photo of the signed sheet if any">
      <Input value={signName} onChangeText={setSignName} placeholder="Client representative" />
      <Chips options={(["1", "2", "3", "4", "5"] as const).map((r) => ({ value: r, label: "★".repeat(Number(r)) }))} value={rating} onChange={setRating} />
      <PhotoStrip projectId={projectId ?? ""} ids={signPhoto} onChange={(ids) => setSignPhoto(ids.slice(-1))} caption="Client sign-off sheet" />
    </Field>
    {parts.some((p) => p.qty === 0) && <Badge tone="warning">select serials for serialised parts</Badge>}
    <Button label="Submit visit for check" onPress={submit} block />
  </Screen>;
}
