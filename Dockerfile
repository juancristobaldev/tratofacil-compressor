# =========================
# BUILDER
# =========================
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

# copiar manifests
COPY package*.json ./

# 👇 prisma debe existir antes de npm ci
COPY prisma ./prisma

# instalar dependencias
RUN npm ci

# copiar código fuente
COPY tsconfig.json nest-cli.json ./
COPY src ./src

# generar cliente prisma
RUN npx prisma generate

# build nestjs
RUN npm run build

# =========================
# RUNTIME (PRODUCCIÓN)
# =========================
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

# copiar manifests
COPY package*.json ./

# 👇 prisma también debe existir aquí
COPY prisma ./prisma

# instalar solo prod deps
RUN npm ci --omit=dev

# copiar build compilado
COPY --from=builder /app/dist ./dist

# copiar prisma client generado
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# iniciar app
# iniciar app
CMD ["node", "dist/main.js"]