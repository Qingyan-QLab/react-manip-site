// Browser-facing website gateway contract. Evaluator JWTs stay on the server.
(() => {
  'use strict';
  const demo = window.ReactManipDemo;
  const configured = (document.querySelector('meta[name="website-api"]')?.content || '').trim();
  const base = demo?.base || configured.replace(/\/+$/, '');
  class ApiError extends Error {
    constructor(message, status = 0) { super(message); this.name = 'ApiError'; this.status = status; }
  }
  const getBase = () => {
    if (!base) throw new ApiError('Online evaluation is not available yet.');
    let url;
    try { url = new URL(base); } catch { throw new ApiError('The website service is not configured correctly.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
      throw new ApiError('The website service requires an HTTPS origin.');
    }
    return url.origin;
  };
  const messages = {
    400: 'The request was not accepted. Check the required fields.',
    401: 'Sign in to the website to access your evaluations.',
    403: 'Your session is no longer valid. Sign in again.',
    404: 'This evaluation or resource is not available to your account.',
    409: 'This request conflicts with an earlier submission. Check your records before retrying.',
    410: 'This video has expired. Evaluation scores remain available.',
    413: 'The submission is too large.',
    416: 'This video range is unavailable. Reopen the video to try again.',
    422: 'Check the published profile, required fields, and public HTTPS model endpoint.',
    429: 'Your request or evaluation quota has been reached. Try again later.',
    503: 'The evaluation service is temporarily unavailable.'
  };
  const request = async (path, { method = 'GET', body, signal, idempotencyKey, csrfToken, timeout = 20000 } = {}) => {
    const origin = getBase();
    if (!path.startsWith('/') || path.startsWith('//')) throw new ApiError('Invalid API path.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    try {
      const response = await fetch(`${origin}/api/v1${path}`, {
        method, headers, signal: controller.signal, credentials: 'include', cache: 'no-store', redirect: 'error',
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (!response.ok) throw new ApiError(messages[response.status] || `The website service returned an error (${response.status}).`, response.status);
      if (response.status === 204) return null;
      try { return await response.json(); } catch { throw new ApiError('The website service returned an invalid response.'); }
    } catch (error) {
      if (timedOut) throw new ApiError('The request timed out. Retry the same submission or check your records.');
      if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
      if (error instanceof TypeError) throw new ApiError('Could not reach the website service. Please try again.');
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
  const mutate = async (path, options = {}) => {
    const session = await request('/session', { signal: options.signal });
    if (!session || typeof session.csrf_token !== 'string' || !session.csrf_token) throw new ApiError(messages[401], 401);
    return request(path, { ...options, method: 'POST', csrfToken: session.csrf_token, timeout: 65000 });
  };
  const rows = (payload, key) => {
    const list = Array.isArray(payload) ? payload : payload?.[key] ?? payload?.items ?? payload?.data;
    if (!Array.isArray(list) || list.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new ApiError(`Invalid ${key} response.`);
    return list;
  };
  const cursor = (payload) => {
    const value = payload?.next_cursor;
    if (value === undefined || value === null || value === '') return null;
    if ((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) || (typeof value === 'string' && /^\d+$/.test(value))) return String(value);
    throw new ApiError('Invalid pagination cursor.');
  };
  const normalizeTeam = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  const status = value => String(value?.status ?? value ?? '').toUpperCase();
  const terminal = value => ['COMPLETED', 'INVALID', 'FAILED', 'CANCELLED'].includes(status(value));
  const score = item => status(item) === 'COMPLETED' && item?.score_kind === 'protocol' && typeof item.score === 'number' && Number.isFinite(item.score) ? item.score.toFixed(2) : '—';
  const date = value => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = new Date(typeof value === 'number' ? value * 1000 : value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const mediaUrl = id => {
    if (demo) return demo.mediaUrl(id);
    return `${getBase()}/api/v1/artifacts/${encodeURIComponent(id)}/content`;
  };
  // Remove the old browser-held bearer configuration during this migration.
  try { sessionStorage.removeItem('react-manip.leaderboard.connection'); } catch { /* Storage is optional. */ }
  window.ReactManipAPI = Object.freeze({ request, mutate, rows, cursor, normalizeTeam, status, terminal, score, date, mediaUrl, configured: Boolean(base), demo: Boolean(demo), ApiError });
})();