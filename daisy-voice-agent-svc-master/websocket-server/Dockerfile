FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package*.json ./
EXPOSE 8081

FROM base AS builder
RUN apk add --no-cache g++ make py3-pip
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

FROM base AS production
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs
RUN adduser -S appuser -u 1001
USER appuser

COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:nodejs /app/package.json ./package.json
COPY --from=builder --chown=appuser:nodejs /app/knexfile.ts ./knexfile.ts

CMD ["npm", "start"]

# Uncomment for development
# FROM base AS dev
# RUN apk add --no-cache g++ make py3-pip
# ENV NODE_ENV=development
# RUN npm install
# COPY . .
# CMD ["npm", "run", "dev"]
