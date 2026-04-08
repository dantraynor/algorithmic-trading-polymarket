FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY shared/package.json shared/package-lock.json* shared/
RUN cd shared && npm ci
COPY shared/ shared/
RUN cd shared && npm run build
COPY alpha-executor/package.json alpha-executor/package-lock.json* alpha-executor/
RUN cd alpha-executor && npm ci
COPY alpha-executor/tsconfig.json alpha-executor/
COPY alpha-executor/src/ alpha-executor/src/
RUN cd alpha-executor && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/alpha-executor/dist/ dist/
COPY --from=builder /app/alpha-executor/node_modules node_modules
CMD ["node", "dist/alpha-executor/src/index.js"]
