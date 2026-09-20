# Wyre Tracker web — build the SPA once, then ship nothing but static files and nginx.
# Build context is the REPO ROOT, not apps/web: the app imports @wyre/api and @wyre/tokens from the workspace.
#   docker build -f apps/web/Dockerfile -t wyre-tracker-web .
FROM node:20-alpine AS build
WORKDIR /repo

# manifests first so a source-only change reuses the cached install
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/api/package.json packages/api/
COPY packages/tokens/package.json packages/tokens/
RUN npm ci

COPY . .

# Relative by default: the app and the API sit behind one nginx, so there is one origin and no CORS.
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
# so "which build are you running?" has an answer in the console and on <html data-build>
ARG VITE_BUILD=unknown
ENV VITE_BUILD=$VITE_BUILD
RUN npm run build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/proxy.inc /etc/nginx/conf.d/proxy.inc
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
