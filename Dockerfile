FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN rm -f package-lock.json && npm install --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package.json ./package.json
EXPOSE 8080
ENV PORT=8080
CMD ["node", ".output/server/index.mjs"]
