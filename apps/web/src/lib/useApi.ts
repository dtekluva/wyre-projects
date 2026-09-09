import { useEffect, useReducer } from "react";
import { api } from "@wyre/api";
/** Subscribes the component to the in-memory API so mutations re-render. */
export function useApi() {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => api.subscribe(() => tick()), []);
  return api;
}
