FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY shared/package.json shared/package-lock.json* shared/
RUN cd shared && npm ci
COPY shared/ shared/
RUN cd shared && npm run build
COPY crypto-signals/package.json crypto-signals/package-lock.json* crypto-signals/
RUN cd crypto-signals && npm ci
COPY crypto-signals/tsconfig.json crypto-signals/
COPY crypto-signals/src/ crypto-signals/src/
RUN cd crypto-signals && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/crypto-signals/dist/ dist/
COPY --from=builder /app/crypto-signals/node_modules node_modules
CMD ["node", "dist/crypto-signals/src/index.js"]
