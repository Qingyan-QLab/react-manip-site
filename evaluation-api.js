// Browser-facing website gateway contract. Evaluator JWTs stay on the server.
(() => {
  'use strict';
  const demo = window.ReactManipDemo;
  const configured = (document.querySelector('meta[name="website-api"]')?.content || '').trim();
  const base = demo?.base || configured.replace(/\/+$/, '');
  const rankingsBase = base || (document.querySelector('meta[name="website-rankings"]')?.content || '').trim().replace(/\/+$/, '');
  const rankingsUnavailable = 'Rankings are temporarily unavailable. Retrying…';
  class ApiError extends Error {
    constructor(message, status = 0, code = '') { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
  }
  const getBase = (value = base) => {
    if (!value) throw new ApiError('Online evaluation is not available yet.');
    let url;
    try { url = new URL(value); } catch { throw new ApiError('The website service is not configured correctly.'); }
    const localPreview = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.origin === location.origin;
    if ((!localPreview && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
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
    422: 'Check the benchmark version, required fields, and public HTTPS model endpoint.',
    429: 'Your request or evaluation quota has been reached. Try again later.',
    503: 'The evaluation service is temporarily unavailable.'
  };
  const send = async (origin, path, { method = 'GET', body, signal, idempotencyKey, csrfToken, timeout = 20000 } = {}, publicOnly = false) => {
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
        method, headers, signal: controller.signal, credentials: publicOnly ? 'omit' : 'include', cache: 'no-store', redirect: 'error',
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (!response.ok) {
        if (response.status === 401 && path !== '/login' && !publicOnly) document.dispatchEvent(new Event('react-manip-session-expired'));
        if (publicOnly) {
          const failure = await response.json().catch(() => null);
          if (response.status === 503 && failure?.detail === 'rankings_not_published') {
            throw new ApiError('Rankings are currently closed.', response.status, 'rankings_closed');
          }
          throw new ApiError(rankingsUnavailable, response.status, 'rankings_unavailable');
        }
        throw new ApiError(messages[response.status] || `The website service returned an error (${response.status}).`, response.status);
      }
      if (response.status === 204) return null;
      try { return await response.json(); } catch { throw new ApiError(publicOnly ? rankingsUnavailable : 'The website service returned an invalid response.', 0, publicOnly ? 'rankings_unavailable' : ''); }
    } catch (error) {
      if (timedOut) throw new ApiError(publicOnly ? rankingsUnavailable : 'The request timed out. Retry the same submission or check your records.', 0, publicOnly ? 'rankings_unavailable' : '');
      if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
      if (error instanceof TypeError) throw new ApiError(publicOnly ? rankingsUnavailable : 'Could not reach the website service. Please try again.', 0, publicOnly ? 'rankings_unavailable' : '');
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
  const request = async (path, options) => send(getBase(), path, options);
  // Public rankings never use a browser session or accept mutation options.
  const rankings = async (profile, { signal } = {}) => {
    if (!rankingsBase) throw new ApiError('Leaderboard is not connected yet.', 0, 'rankings_unconfigured');
    let origin;
    try { origin = getBase(rankingsBase); } catch { throw new ApiError(rankingsUnavailable, 0, 'rankings_unavailable'); }
    return send(origin, `/rankings${profile ? `?profile_id=${encodeURIComponent(profile)}` : ''}`, { signal }, true);
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
  const cursor = (payload, { opaque = false } = {}) => {
    const value = payload?.next_cursor;
    if (value === undefined || value === null || value === '') return null;
    if ((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) || (typeof value === 'string' && /^\d+$/.test(value))) return String(value);
    if (opaque && typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value)) return value;
    throw new ApiError('Invalid pagination cursor.');
  };
  const normalizeTeam = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  // Presentation names only: keep immutable IDs in requests and stored results.
  // Map exact published versions so a later validation run never inherits this name.
  const profileNames = new Map([
    ['validation-attempt-20261104T062405Z-fb194c0cde95', 'ReAct-Manip v1.0'],
    ['demo-16x3x15-v1', 'ReAct-Manip Demo']
  ]);
  const profileLabel = value => {
    const id = typeof value === 'string' ? value : value?.profile_id ?? value?.id;
    return profileNames.get(id) || id || '—';
  };
  const status = value => value?.relay_state === 'REJECTED' ? 'FAILED' : String(value?.status ?? value ?? '').toUpperCase();
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
  window.ReactManipAPI = Object.freeze({ request, mutate, rankings, rows, cursor, normalizeTeam, profileLabel, status, terminal, score, date, mediaUrl, configured: Boolean(base), rankingsConfigured: Boolean(rankingsBase), demo: Boolean(demo), ApiError });
})();
