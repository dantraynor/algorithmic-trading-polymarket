import Redis from 'ioredis';

const SOCKET_PATH = process.env.REDIS_SOCKET_PATH || '/var/run/redis/redis.sock';

let redis: Redis | null = null;
let subscriber: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(SOCKET_PATH);
  }
  return redis;
}

export function getSubscriber(): Redis {
  if (!subscriber) {
    subscriber = new Redis(SOCKET_PATH);
  }
  return subscriber;
}

/** Create a fresh Redis subscriber (one per SSE connection). */
export function createSubscriber(): Redis {
  const socketPath = process.env.REDIS_SOCKET_PATH || '/var/run/redis/redis.sock';
  return new Redis(socketPath);
}
