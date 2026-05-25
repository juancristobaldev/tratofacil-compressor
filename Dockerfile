# =========================
# BUILDER
# =========================
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

# copiar manifests primero (cache eficiente)
COPY package*.json ./

RUN npm ci

# copiar código
COPY tsconfig.json nest-cli.json ./
COPY prisma ./prisma
COPY src ./src

# generar prisma + build
RUN npx prisma generate
RUN npm run build

#
# =========================
# RUNTIME (PRODUCCIÓN)
# =========================
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

# solo dependencias de producción
COPY package*.json ./
RUN npm ci --omit=dev

# copiar build y prisma generado
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist

# ejecutar app
CMD ["node", "dist/main"]