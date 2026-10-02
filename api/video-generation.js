import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import {
  FreeQuotaSetupError,
  getFreeGenerationLink,
  getFreePlan,
  getFreeQuotaContext,
  linkFreeGeneration,
  releaseFreeGeneration,
  reserveFreeGeneration,
  settleFreeGeneration
} from '../lib/free-quota.js';

const REPLICATE_API = 'https://api.replicate.com/v1';
const DEFAULT_REPLICATE_MODEL = 'kwaivgi/kling-v2.1-master';
const MAX_IMAGE_BYTES = 1024 * 1024;
const RESERVATION_TIMEOUT_MINUTES = 20;

function sendJson(response, status, payload) {
  response.status(status).setHeader('Cache-Control', 'no-store').json(payload);
}

function getProvider() {
  const name = String(process.env.VIDEO_PROVIDER || 'wan').trim().toLowerCase();
  if (name === 'replicate') {
    const model = process.env.VIDEO_MODEL || DEFAULT_REPLICATE_MODEL;
    const validModel = /^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.-]*$/i.test(model);
    const configured = Boolean(process.env.r8_erluHWEiVDCsHZf4hjidsYaVuVCgGql4UQPfgVIDEO_API_KEY && validModel);
    const message = !validModel
      ? 'Replicate is selected, but VIDEO_MODEL is invalid.'
      : !process.env.VIDEO_API_KEY
        ? 'Replicate is selected, but VIDEO_API_KEY is missing. This provider may bill the operator.'
        : '';
    return { name, label: 'Replicate', model: validModel ? model : '', configured, message };
  }
  if (name === 'wan') {
    let baseUrl = '';
    try {
      const url = new URL(process.env.WAN_VIDEO_API_URL || '');
      if (url.protocol === 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) baseUrl = url.toString().replace(/\/$/, '');
    } catch (_) {}
    return {
      name,
      label: 'Wan-compatible provider',
      model: process.env.WAN_VIDEO_MODEL || 'Wan2.1',
      baseUrl,
      token: process.env.WAN_VIDEO_API_TOKEN || '',
      configured: Boolean(baseUrl),
      message: baseUrl ? '' : 'Wan-compatible provider is selected, but WAN_VIDEO_API_URL is missing or invalid.'
    };
  }
  return { name, label: 'Video provider', model: '', configured: false, message: 'Unknown VIDEO_PROVIDER. Choose wan or replicate in the server environment.' };
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return request.method !== 'POST';
  try {
    const originHost = new URL(origin).host;
    const requestHost = request.headers['x-forwarded-host'] || request.headers.host;
    return originHost.toLowerCase() === String(requestHost || '').toLowerCase();
  } catch (_) {
    return false;
  }
}

function parseBody(body) {
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string') return JSON.parse(body);
  return {};
}

function validateImageData(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
  return dataUrl;
}

async function providerRequest(provider, path, options = {}) {
  const baseUrl = provider.name === 'replicate' ? REPLICATE_API : provider.baseUrl;
  const token = provider.name === 'replicate' ? process.env.VIDEO_API_KEY : provider.token;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function publicError(status) {
  if (status === 422) return { status: 400, message: 'The video provider could not use these settings. Try a shorter prompt or another aspect ratio.' };
  return { status: 503, message: 'AI generation is temporarily unavailable. Please try again later.' };
}

function findOutputUrl(output, provider) {
  const candidates = [];
  if (typeof output === 'string') candidates.push(output);
  if (Array.isArray(output)) candidates.push(...output.filter((item) => typeof item === 'string'));
  if (output && typeof output === 'object') candidates.push(output.video, output.url);
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    try {
      const baseUrl = provider.name === 'replicate' ? REPLICATE_API : provider.baseUrl;
      const url = new URL(candidate, baseUrl);
      const trustedReplicateUrl = provider.name === 'replicate' && (url.hostname === 'replicate.delivery' || url.hostname.endsWith('.replicate.delivery'));
      const sameProviderOrigin = provider.name === 'wan' && url.origin === new URL(provider.baseUrl).origin;
      if (url.protocol === 'https:' && (trustedReplicateUrl || sameProviderOrigin)) return url.toString();
      if (url.protocol === 'http:' && sameProviderOrigin && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.toString();
    } catch (_) {}
  }
  return '';
}

async function getPrediction(provider, id) {
  const response = await providerRequest(provider, `/predictions/${encodeURIComponent(id)}`);
  if (!response.ok) throw Object.assign(new Error('The provider could not retrieve this generation.'), { providerStatus: response.status });
  return response.json();
}

async function cancelPrediction(provider, id) {
  try {
    await providerRequest(provider, `/predictions/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  } catch (_) {}
}

function quotaPayload(context, used = context.used) {
  return {
    used,
    remaining: Math.max(0, context.plan.limit - used),
    limit: context.plan.limit,
    maxDuration: context.plan.maxDuration,
    providerMaxDuration: context.plan.providerMaxDuration
  };
}

function exhaustedPayload(context) {
  return {
    error: `You have used all ${context.plan.limit} free video generations.`,
    limitMessage: `Free limit: ${context.plan.limit} videos × up to ${context.plan.maxDuration} seconds.`,
    quota: quotaPayload(context)
  };
}

export default async function handler(request, response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  if (!sameOrigin(request)) return sendJson(response, 403, { error: 'Cross-origin requests are not allowed.' });

  if (request.method === 'GET' && request.query?.action === 'config') {
    const provider = getProvider();
    try {
      const context = await getFreeQuotaContext(request, response);
      return sendJson(response, 200, {
        configured: provider.configured,
        quotaConfigured: true,
        provider: provider.label,
        providerId: provider.name,
        providerMessage: provider.message,
        model: provider.model,
        quota: { used: context.used, remaining: context.remaining, limit: context.plan.limit, maxDuration: context.plan.maxDuration, providerMaxDuration: context.plan.providerMaxDuration },
        message: provider.message
      });
    } catch (error) {
      return sendJson(response, 200, {
        configured: provider.configured,
        quotaConfigured: false,
        provider: provider.label,
        providerId: provider.name,
        providerMessage: provider.message,
        quotaMessage: error instanceof FreeQuotaSetupError ? error.message : 'Free video quota storage is unavailable. Try again later.',
        model: provider.model,
        message: [provider.message, error instanceof FreeQuotaSetupError ? error.message : 'Free video quota storage is unavailable. Try again later.'].filter(Boolean).join(' ')
      });
    }
  }

  const provider = getProvider();
  if (!provider.configured) return sendJson(response, 503, { error: 'AI generation is temporarily unavailable. Please try again later.' });

  if (request.method === 'POST') {
    let body;
    try {
      body = parseBody(request.body);
    } catch (_) {
      return sendJson(response, 400, { error: 'The generation request was not valid JSON.' });
    }
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const mode = body.mode;
    const duration = Number(body.duration);
    const aspectRatio = body.aspectRatio;
    const plan = getFreePlan();
    if (prompt.length < 3 || prompt.length > 1200) return sendJson(response, 400, { error: 'Enter a prompt between 3 and 1200 characters.' });
    if (!['text', 'image'].includes(mode)) return sendJson(response, 400, { error: 'Choose text-to-video or image-to-video.' });
    if (!Number.isInteger(duration) || duration < 1 || duration > plan.maxDuration) {
      return sendJson(response, 400, { error: `Choose a duration no longer than ${plan.maxDuration} seconds.` });
    }
    if (duration > plan.providerMaxDuration) {
      return sendJson(response, 400, { error: `This provider supports generations up to ${plan.providerMaxDuration} seconds. Choose a shorter duration.` });
    }
    if (mode === 'text' && !['16:9', '9:16', '1:1'].includes(aspectRatio)) return sendJson(response, 400, { error: 'Choose a supported aspect ratio.' });

    const input = { prompt, duration };
    if (mode === 'image') {
      const image = validateImageData(body.imageDataUrl);
      if (!image) return sendJson(response, 400, { error: 'Choose a JPG or PNG starting image smaller than 1 MB.' });
      input.start_image = image;
    } else {
      input.aspect_ratio = aspectRatio;
    }

    let context;
    try {
      context = await getFreeQuotaContext(request, response);
    } catch (error) {
      return sendJson(response, 503, { error: error.message || 'Free-generation storage is unavailable. Try again later.' });
    }

    const reservationId = randomUUID();
    let reservation;
    try {
      reservation = await reserveFreeGeneration(context, reservationId);
    } catch (_) {
      return sendJson(response, 503, { error: 'Free-generation storage is unavailable. No generation was started.' });
    }
    context.used = reservation.used;
    if (!reservation.reserved) {
      if (reservation.used >= context.plan.limit) return sendJson(response, 429, exhaustedPayload(context));
      return sendJson(response, 429, {
        error: 'All free generation slots are currently processing. Wait for them to finish, then try again.',
        quota: quotaPayload(context)
      });
    }

    let predictionId = '';
    let linked = false;
    try {
      const providerPath = provider.name === 'replicate' ? `/models/${provider.model}/predictions` : '/predictions';
      const providerInput = provider.name === 'wan' ? { ...input, model: provider.model } : input;
      const providerResponse = await providerRequest(provider, providerPath, {
        method: 'POST',
        ...(provider.name === 'replicate' ? { headers: { 'Cancel-After': `${RESERVATION_TIMEOUT_MINUTES}m` } } : {}),
        body: JSON.stringify({ input: providerInput })
      });
      if (!providerResponse.ok) {
        await releaseFreeGeneration(context, reservationId);
        const mapped = publicError(providerResponse.status);
        return sendJson(response, mapped.status, { error: mapped.message, quota: quotaPayload(context) });
      }
      const prediction = await providerResponse.json();
      predictionId = prediction.id;
      if (typeof predictionId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(predictionId)) {
        await releaseFreeGeneration(context, reservationId);
        return sendJson(response, 502, { error: 'The provider did not return a generation ID. No free generation was used.', quota: quotaPayload(context) });
      }
      linked = await linkFreeGeneration(context, predictionId, reservationId);
      if (!linked) {
        await cancelPrediction(provider, predictionId);
        await releaseFreeGeneration(context, reservationId);
        return sendJson(response, 503, { error: 'Free-generation storage could not track this request, so the provider job was canceled.' });
      }
      return sendJson(response, 202, {
        id: predictionId,
        status: prediction.status || 'starting',
        quota: quotaPayload(context)
      });
    } catch (error) {
      if (!linked) await releaseFreeGeneration(context, reservationId).catch(() => {});
      if (predictionId) await cancelPrediction(provider, predictionId);
      if (error.name === 'AbortError') return sendJson(response, 503, { error: 'AI generation is temporarily unavailable. Please try again later. No free generation was used.', quota: quotaPayload(context) });
      return sendJson(response, 503, { error: 'AI generation is temporarily unavailable. Please try again later. No free generation was used.', quota: quotaPayload(context) });
    }
  }

  if (request.method === 'GET') {
    const id = String(request.query?.id || '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return sendJson(response, 400, { error: 'This generation ID is invalid.' });
    try {
      const context = await getFreeQuotaContext(request, response);
      const link = await getFreeGenerationLink(context, id);
      if (link.state === 'missing') return sendJson(response, 404, { error: 'This generation does not belong to this browser profile or has expired.' });
      if (link.state === 'expired' || link.state === 'limit') {
        return sendJson(response, 409, { error: 'This generation reservation expired. Start a new request if free generations remain.', quota: quotaPayload(context) });
      }
      const prediction = await getPrediction(provider, id);
      let quota = quotaPayload(context);
      if (prediction.status === 'succeeded') {
        const settlement = await settleFreeGeneration(context, id, 'success');
        if (settlement.state !== 'success') {
          return sendJson(response, 409, { error: 'The completed video could not be safely committed to the free-generation limit.', quota: { ...quota, used: settlement.used, remaining: settlement.remaining } });
        }
        context.used = settlement.used;
        quota = quotaPayload(context, settlement.used);
      } else if (prediction.status === 'failed' || prediction.status === 'canceled') {
        const settlement = await settleFreeGeneration(context, id, 'failed');
        context.used = settlement.used;
        quota = quotaPayload(context, settlement.used);
      }
      if (request.query?.action === 'download') {
        if (prediction.status !== 'succeeded') return sendJson(response, 409, { error: 'This video is not ready to download yet.', quota });
        const outputUrl = findOutputUrl(prediction.output, provider);
        if (!outputUrl) return sendJson(response, 502, { error: 'The provider did not return a downloadable video.', quota });
        const outputResponse = await fetch(outputUrl, {
          headers: provider.name === 'replicate'
            ? { Authorization: `Bearer ${process.env.VIDEO_API_KEY}` }
            : (provider.token ? { Authorization: `Bearer ${provider.token}` } : {}),
          signal: AbortSignal.timeout(30000)
        });
        if (!outputResponse.ok || !outputResponse.body) return sendJson(response, 502, { error: 'The generated video could not be retrieved from the provider.', quota });
        response.status(200);
        response.setHeader('Content-Type', outputResponse.headers.get('content-type')?.includes('video') ? outputResponse.headers.get('content-type') : 'video/mp4');
        response.setHeader('Content-Disposition', 'inline; filename="tabhi-ai-generated.mp4"');
        response.setHeader('Cache-Control', 'private, no-store');
        if (outputResponse.headers.has('content-length')) response.setHeader('Content-Length', outputResponse.headers.get('content-length'));
        return Readable.fromWeb(outputResponse.body).pipe(response);
      }
      const failure = prediction.status === 'failed' || prediction.status === 'canceled';
      return sendJson(response, 200, {
        id: prediction.id,
        status: prediction.status,
        error: failure ? 'The provider could not generate this video. Adjust the prompt and try again.' : '',
        quota
      });
    } catch (error) {
      if (error instanceof FreeQuotaSetupError) return sendJson(response, 503, { error: error.message });
      if (error.providerStatus) {
        const mapped = publicError(error.providerStatus);
        return sendJson(response, mapped.status, { error: mapped.message });
      }
      if (error.name === 'AbortError' || error.name === 'TimeoutError') return sendJson(response, 503, { error: 'AI generation is temporarily unavailable. Please try again later.' });
      return sendJson(response, 503, { error: 'AI generation is temporarily unavailable. Please try again later.' });
    }
  }

  response.setHeader('Allow', 'GET, POST');
  return sendJson(response, 405, { error: 'This request method is not supported.' });
}
