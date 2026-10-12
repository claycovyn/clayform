# Clayform — one container, one SQLite file, no external services.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 CLAYFORM_STANDALONE=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 CLAYFORM_DATA_DIR=/data
RUN addgroup -S clay && adduser -S clay -G clay && mkdir -p /data && chown clay:clay /data
COPY --from=build --chown=clay:clay /app/.next/standalone ./
COPY --from=build --chown=clay:clay /app/.next/static ./.next/static
COPY --from=build --chown=clay:clay /app/public ./public
USER clay
VOLUME /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
