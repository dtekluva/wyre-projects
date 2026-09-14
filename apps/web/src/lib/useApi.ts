import { useEffect, useReducer } from "react";
import { api } from "./api";
/** Subscribes the component to the API store (mock or live snapshot) so mutations re-render. */
export function useApi() {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => api.subscribe(() => tick()), []);
  return api;
}
