# Wyre Project Portfolio Tracker

Standalone monorepo.

- `apps/web` — Phase 1 web app (React + TypeScript + Vite). PM / Finance / Director / Store Keeper / Auditor.
- `apps/mobile` — (Phase 3) native field-tech app (React Native / Expo). Shares tokens + API.
- `packages/tokens` — design tokens: Northstar (`--ns-*`) married with the Wyre brand. `tokens.json` is the source of truth → `dist/tokens.css` (web) + `dist/tokens.ts` (native).
- `packages/api` — shared domain types + API client. Phase 1 runs on an in-memory mock; swap the transport for the Django backend later.

```bash
npm install
npm run dev        # builds tokens, starts web on http://localhost:5173
```

Spec: `wyre-files/project_tracker_spec.md` (Liberty workspace).
