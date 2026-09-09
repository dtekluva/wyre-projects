import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";

export interface Shot { uri: string; fileName: string }
/** Camera on device; the simulator has no camera so the library is the fallback. */
export async function takePhoto(fromCamera: boolean): Promise<Shot | null> {
  const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = fromCamera ? await ImagePicker.launchCameraAsync({ quality: 0.6 }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ["images"] });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0]; return { uri: a.uri, fileName: a.fileName ?? a.uri.split("/").pop() ?? "photo.jpg" };
}
export async function currentGps(): Promise<{ lat: number; lng: number } | undefined> {
  try { const p = await Location.requestForegroundPermissionsAsync(); if (!p.granted) return undefined;
    const l = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }); return { lat: l.coords.latitude, lng: l.coords.longitude }; }
  catch { return undefined; }
}
export const isImageUri = (s: string) => /^(file:|ph:|content:|http|assets-library:)/.test(s);
