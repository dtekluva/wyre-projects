import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { api, type Attachment } from "@wyre/api";
import { currentGps, isImageUri, takePhoto } from "@/capture";
import { useUser } from "@/store";
import { Button, P, Row } from "@/ui";
import { T } from "@/theme";

export function Thumb({ att }: { att: Attachment }) {
  return isImageUri(att.fileName)
    ? <Image source={{ uri: att.fileName }} style={{ width: 84, height: 84, borderRadius: T.radius.md, backgroundColor: T.color.surfaceSubtle }} contentFit="cover" />
    : <View style={{ width: 84, height: 84, borderRadius: T.radius.md, backgroundColor: T.color.primarySubtle, alignItems: "center", justifyContent: "center", padding: 6 }}><P small tone="muted" style={{ textAlign: "center" }}>{att.caption ?? att.fileName}</P></View>;
}
/** Evidence photos for one object. Adding a photo creates a pending Attachment (maker-checked) with GPS. */
export function PhotoStrip({ projectId, ids, onChange, caption, readOnly }: { projectId: string; ids: string[]; onChange?: (ids: string[]) => void; caption: string; readOnly?: boolean }) {
  const user = useUser(); const [busy, setBusy] = useState(false);
  const atts = ids.map((id) => api.attachments.find((a) => a.id === id)).filter((a): a is Attachment => !!a);
  const add = async (cam: boolean) => {
    if (!projectId) { Alert.alert("Choose a project first"); return; }
    setBusy(true);
    try { const shot = await takePhoto(cam); if (!shot) return; const gps = await currentGps();
      const att = api.addAttachment(user.id, projectId, { fileName: shot.uri, caption, kind: "image", gps }); onChange?.([...ids, att.id]); }
    catch (e) { Alert.alert("Could not attach photo", (e as Error).message); }
    finally { setBusy(false); }
  };
  return <View style={{ gap: 8 }}>
    <Row wrap>{atts.map((a) => <Pressable key={a.id} onLongPress={() => !readOnly && onChange?.(ids.filter((x) => x !== a.id))}><Thumb att={a} />{a.gps && <P small tone="faint" style={{ fontSize: 10 }}>📍 {a.gps.lat.toFixed(3)}, {a.gps.lng.toFixed(3)}</P>}</Pressable>)}
      {!atts.length && <P small tone="faint">No photos yet</P>}</Row>
    {!readOnly && <Row><Button label={busy ? "…" : "📷 Camera"} kind="secondary" onPress={() => add(true)} disabled={busy} /><Button label="🖼 Library" kind="ghost" onPress={() => add(false)} disabled={busy} /></Row>}
  </View>;
}
