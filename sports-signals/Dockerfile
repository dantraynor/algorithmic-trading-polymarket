FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY shared/package.json shared/package-lock.json* shared/
RUN cd shared && npm ci
COPY shared/ shared/
RUN cd shared && npm run build
COPY sports-signals/package.json sports-signals/package-lock.json* sports-signals/
RUN cd sports-signals && npm ci
COPY sports-signals/tsconfig.json sports-signals/
COPY sports-signals/src/ sports-signals/src/
RUN cd sports-signals && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/sports-signals/dist/ dist/
COPY --from=builder /app/sports-signals/node_modules node_modules
CMD ["node", "dist/sports-signals/src/index.js"]
