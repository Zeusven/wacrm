# wacrm — build multi-stage para Dokploy (modo Compose).
# Sin `output: standalone` en next.config.ts, así que la imagen final
# lleva node_modules completo + build. Más pesada que standalone, pero
# es el modo que el propio proyecto usa (Hostinger managed Node.js), sin
# sorpresas de compatibilidad con next-intl/CSP en modo standalone.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Variables NEXT_PUBLIC_* deben existir en build time (quedan embebidas
# en el bundle del cliente). Dokploy las inyecta como build args si están
# en el .env del servicio — ver docker-compose.yml.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_LOCALE
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_APP_LOCALE=$NEXT_PUBLIC_APP_LOCALE
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Copia todo /app del builder (no solo standalone) — `headers()` en
# next.config.ts se evalúa en runtime, y no hay forma de testear acá si
# un COPY selectivo dejaría algo afuera. Más pesado, cero riesgo de
# "funciona el build, falla el start por un archivo faltante".
COPY --from=builder /app ./

EXPOSE 3000
CMD ["npm", "start"]
