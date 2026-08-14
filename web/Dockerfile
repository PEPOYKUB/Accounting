# ---------- ขั้นที่ 1: ติดตั้ง dependency ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

# ---------- ขั้นที่ 2: build ----------
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts || npm install --ignore-scripts
COPY . .
# ปิด telemetry และ build เป็น standalone เพื่อให้ image เล็ก
ENV NEXT_TELEMETRY_DISABLED=1

# next.config.ts ถูกอ่านตอน build และฝังผลลัพธ์ลง .next
# ค่านี้จึงต้องส่งเป็น build arg ตั้งเป็น environment ตอนรันไม่มีผล
ARG ALLOWED_ORIGINS=""
ENV ALLOWED_ORIGINS=$ALLOWED_ORIGINS

RUN npm run build

# ---------- ขั้นที่ 3: รันจริง ----------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3100
ENV TZ=Asia/Bangkok
# ใน Docker ตัวแปร HOSTNAME คือรหัสคอนเทนเนอร์ ทำให้ server.js ผูกกับอินเทอร์เฟซนั้นตัวเดียว
# ต้องบังคับเป็น 0.0.0.0 มิฉะนั้นเข้าจากภายนอกคอนเทนเนอร์ไม่ได้เลย
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache tzdata curl \
 && addgroup -g 1001 -S nodejs \
 && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3100

HEALTHCHECK --interval=20s --timeout=5s --start-period=25s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3100/login > /dev/null || exit 1

CMD ["node", "server.js"]
