import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Redis } from '@upstash/redis';

const COOKIE_NAME = 'tabhi_free_user';
const KEY_PREFIX = 'tabhi:free:v1';
const RESERVATION_TTL_SECONDS = 25 * 60;
const PREDICTION_TTL_SECONDS = 2 * 60 * 60;
let redisClient;

const SNAPSHOT_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local pending = tonumber(redis.call('ZCARD', KEYS[2]) or '0')
return { used, pending }
`;

const RESERVE_SCRIPT = `
local now = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local pending = tonumber(redis.call('ZCARD', KEYS[2]) or '0')
local limit = tonumber(ARGV[2])
if used + pending >= limit then
  return { 0, used, pending }
end
local expires = now + tonumber(ARGV[4])
redis.call('ZADD', KEYS[2], 'NX', expires, ARGV[3])
redis.call('EXPIRE', KEYS[2], math.ceil(tonumber(ARGV[4]) / 1000) + 60)
return { 1, used, pending + 1 }
`;

const LINK_SCRIPT = `
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then
  return 0
end
redis.call('SET', KEYS[2], 'pending:' .. ARGV[1], 'EX', ARGV[2])
return 1
`;

const RELEASE_SCRIPT = `
redis.call('ZREM', KEYS[1], ARGV[1])
return 1
`;

const SETTLE_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
local state = redis.call('GET', KEYS[3])
if state == 'success' or state == 'failed' then
  return { used, state }
end
if not state or string.sub(state, 1, 8) ~= 'pending:' then
  return { used, 'missing' }
end
local reservation = string.sub(state, 9)
if not redis.call('ZSCORE', KEYS[2], reservation) then
  redis.call('SET', KEYS[3], 'expired', 'EX', ARGV[3])
  return { used, 'expired' }
end
redis.call('ZREM', KEYS[2], reservation)
if ARGV[1] == 'success' then
  if used >= tonumber(ARGV[2]) then
    redis.call('SET', KEYS[3], 'limit', 'EX', ARGV[3])
    return { used, 'limit' }
  end
  used = redis.call('INCR', KEYS[1])
  redis.call('SET', KEYS[3], 'success', 'EX', ARGV[3])
  return { used, 'success' }
end
redis.call('SET', KEYS[3], 'failed', 'EX', ARGV[3])
return { used, 'failed' }
`;

export class FreeQuotaSetupError extends Error {}

function positiveSetting(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function getFreePlan() {
  const providerMaxDuration = positiveSetting('VIDEO_PROVIDER_MAX_DURATION', process.env.VIDEO_PROVIDER === 'replicate' ? 10 : 5);
  return {
    limit: positiveSetting('FREE_VIDEO_LIMIT', 5),
    maxDuration: Math.min(50, positiveSetting('FREE_VIDEO_MAX_DURATION', 50)),
    providerMaxDuration: Math.min(50, providerMaxDuration)
  };
}

function getRedis() {
  if (redisClient) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new FreeQuotaSetupError('Free-generation storage is not configured. Set the Upstash Redis environment variables.');
  redisClient = new Redis({ url, token });
  return redisClient;
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    let value = part.slice(separator + 1).trim();
    try { value = decodeURIComponent(value); } catch (_) { return ['', '']; }
    return [part.slice(0, separator).trim(), value];
  }).filter(([name]) => name));
}

function signUserId(userId, secret) {
  return createHmac('sha256', secret).update(userId).digest('hex');
}

function validUserIdCookie(value, secret) {
  if (!value) return '';
  const separator = value.lastIndexOf('.');
  if (separator < 0) return '';
  const userId = value.slice(0, separator);
  const supplied = value.slice(separator + 1);
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(userId) || !/^[a-f0-9]{64}$/.test(supplied)) return '';
  const expected = signUserId(userId, secret);
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)) ? userId : '';
}

function getUserId(request, response) {
  const secret = process.env.TABHI_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new FreeQuotaSetupError('Free-generation identity is not configured. Set TABHI_SESSION_SECRET to a random value with at least 32 characters.');
  }
  const cookies = parseCookies(request.headers.cookie);
  let userId = validUserIdCookie(cookies[COOKIE_NAME], secret);
  if (!userId) {
    userId = randomBytes(32).toString('base64url');
    const secure = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    const attributes = [`${COOKIE_NAME}=${encodeURIComponent(`${userId}.${signUserId(userId, secret)}`)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${365 * 24 * 60 * 60}`];
    if (secure) attributes.push('Secure');
    response.setHeader('Set-Cookie', attributes.join('; '));
  }
  return createHmac('sha256', secret).update(`quota:${userId}`).digest('hex');
}

function keysFor(userHash) {
  const userPrefix = `${KEY_PREFIX}:user:${userHash}`;
  return {
    used: `${userPrefix}:used`,
    reservations: `${userPrefix}:reservations`,
    prediction: (id) => `${userPrefix}:prediction:${id}`
  };
}

export async function getFreeQuotaContext(request, response) {
  const userHash = getUserId(request, response);
  const redis = getRedis();
  const plan = getFreePlan();
  const keys = keysFor(userHash);
  const [usedValue, pendingValue] = await redis.eval(SNAPSHOT_SCRIPT, [keys.used, keys.reservations], [Date.now()]);
  const used = Number(usedValue) || 0;
  const pending = Number(pendingValue) || 0;
  return { redis, keys, userHash, plan, used, pending, remaining: Math.max(0, plan.limit - used) };
}

export async function reserveFreeGeneration(context, reservationId) {
  const result = await context.redis.eval(
    RESERVE_SCRIPT,
    [context.keys.used, context.keys.reservations],
    [Date.now(), context.plan.limit, reservationId, RESERVATION_TTL_SECONDS * 1000]
  );
  const [reserved, used, pending] = result.map(Number);
  return { reserved: reserved === 1, used, pending, remaining: Math.max(0, context.plan.limit - used) };
}

export async function releaseFreeGeneration(context, reservationId) {
  await context.redis.eval(RELEASE_SCRIPT, [context.keys.reservations], [reservationId]);
}

export async function linkFreeGeneration(context, predictionId, reservationId) {
  const linked = await context.redis.eval(
    LINK_SCRIPT,
    [context.keys.reservations, context.keys.prediction(predictionId)],
    [reservationId, PREDICTION_TTL_SECONDS]
  );
  return Number(linked) === 1;
}

export async function getFreeGenerationLink(context, predictionId) {
  const state = await context.redis.get(context.keys.prediction(predictionId));
  if (typeof state === 'string' && state.startsWith('pending:')) {
    return { state: 'pending', reservationId: state.slice('pending:'.length) };
  }
  return { state: typeof state === 'string' ? state : 'missing', reservationId: '' };
}

export async function settleFreeGeneration(context, predictionId, outcome) {
  const [usedValue, state] = await context.redis.eval(
    SETTLE_SCRIPT,
    [context.keys.used, context.keys.reservations, context.keys.prediction(predictionId)],
    [outcome, context.plan.limit, PREDICTION_TTL_SECONDS]
  );
  const used = Number(usedValue) || 0;
  return { used, state, remaining: Math.max(0, context.plan.limit - used), limit: context.plan.limit };
}
