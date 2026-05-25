# =========================
# BUILDER
# =========================
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

# copiar manifests
COPY package*.json ./

# prisma antes de npm ci
COPY prisma ./prisma

# instalar deps
RUN npm ci

# copiar código
COPY tsconfig.json nest-cli.json ./
COPY src ./src

# generar prisma
RUN npx prisma generate

# build nest
RUN npm run build

# =========================
# RUNTIME
# =========================
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production

# copiar package
COPY package*.json ./

# copiar prisma
COPY prisma ./prisma

# copiar node_modules completos
COPY --from=builder /app/node_modules ./node_modules

# copiar dist compilado
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/main.js"]