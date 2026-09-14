// Chooses the data layer once: VITE_API_URL set → live Django backend (RemoteApi); unset → in-browser mock with demo data.
import { api as mockApi, RemoteApi, type MockApi } from "@wyre/api";

const url = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
export const remote: RemoteApi | null = url ? new RemoteApi(url.replace(/\/+$/, "")) : null;
export const api: MockApi = remote ?? mockApi;
export const isRemote = remote !== null;
