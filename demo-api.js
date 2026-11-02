// Explicit browser-only fixture. No evaluator, website database or real model is contacted.
(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('demo') !== '1') return;
  const base = 'https://demo.react-manip.invalid';
  const profile = 'demo-16x3x15-v1', now = () => Math.floor(Date.now() / 1000);
  const copy = value => JSON.parse(JSON.stringify(value));
  const metadata = new Map(), attempts = new Map(), polls = new Map();
  const records = [{ evaluation_id: 'demo-evaluation-1', team_display_name: 'Demo team', model_id: 'sample-policy', model_version: 'v1', profile_id: profile,
    status: 'COMPLETED', completed_episodes: 720, score: 83.25, score_kind: 'protocol', official_score: null, eligible_for_ranking: true,
    finished_at: now(), videos_expires_at: now() + 7 * 86400, website_metadata: { organization: 'Demo lab', submission_type: 'agent' } }];
  metadata.set(records[0].evaluation_id, { ...records[0].website_metadata, email: 'demo@example.com', contact_method: 'phone', contact_value: '+8613800000000' });
  const tasks = window.REACT_MANIP_TASKS || [];
  // Preserve the original repository-hosted video lookup, including GitHub Pages subpaths.
  const videoBase = new URL('videos/', window.location.href);
  const taskRows = item => Array.from({ length: 16 }, (_, index) => ({ task_id: tasks[index]?.name || `task_${String(index + 1).padStart(2, '0')}`, status: item.status,
    score: item.status === 'COMPLETED' ? item.score : null, completed_episodes: item.status === 'COMPLETED' ? 45 : 0, total_episodes: 45 }));
  const videos = item => taskRows(item).map((task, index) => ({ artifact_id: `${item.evaluation_id}-video-${index + 1}`, task_id: task.task_id,
    phase: 'exam', episode_index: 0, status: 'READY', expires_at: item.videos_expires_at }));
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
  window.ReactManipDemo = Object.freeze({ base, mediaUrl: id => {
    const match = /^demo-evaluation-\d+-video-(\d+)$/.exec(String(id));
    if (!match || +match[1] < 1 || +match[1] > 16) throw new Error('Demo video not found.');
    const file = tasks[Number(match[1]) - 1]?.video;
    if (!file) throw new Error('Demo video not found.');
    return new URL(file, videoBase).href;
  } });
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (url.origin !== base) return originalFetch(input, init);
    if (init.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    const method = (init.method || input?.method || 'GET').toUpperCase(), path = url.pathname;
    const headers = new Headers(init.headers || input?.headers);
    if (method === 'POST' && headers.get('X-CSRF-Token') !== 'demo-csrf-not-a-secret') return json({ error: 'Session required' }, 403);
    if (path === '/api/v1/session' && method === 'GET') return json({ csrf_token: 'demo-csrf-not-a-secret' });
    if (path === '/api/v1/profiles' && method === 'GET') return json({ profiles: [{ profile_id: profile }] });
    if (path === '/api/v1/rankings' && method === 'GET') {
      if (url.searchParams.get('profile_id') && url.searchParams.get('profile_id') !== profile) return json({ error: 'Profile not found' }, 404);
      const latest = new Map();
      for (const item of records) if (item.status === 'COMPLETED' && item.eligible_for_ranking && !latest.has(item.team_display_name)) latest.set(item.team_display_name, item);
      const rankings = [...latest.values()].sort((a, b) => b.score - a.score).map(item => ({ evaluation_id: item.evaluation_id, profile_id: profile,
        team_display_name: item.team_display_name, model_id: item.model_id, model_version: item.model_version, status: item.status,
        score: item.score, score_kind: 'protocol', official_score: null, eligible_for_ranking: true, website_metadata: { submission_type: item.website_metadata.submission_type } }));
      return json({ profiles: [{ profile_id: profile }], profile_id: profile, rankings });
    }
    if (path === '/api/v1/evaluations' && method === 'GET') {
      const after = Number(url.searchParams.get('after') || 0), limit = Math.min(50, Number(url.searchParams.get('limit') || 50));
      if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1) return json({ error: 'Invalid pagination' }, 422);
      return json({ evaluations: copy(records.slice(after, after + limit)), next_cursor: after + limit < records.length ? after + limit : null });
    }
    if (path === '/api/v1/evaluations' && method === 'POST') {
      let payload;
      try { payload = typeof init.body === 'string' ? JSON.parse(init.body) : await input.clone().json(); } catch { return json({ error: 'Invalid request' }, 400); }
      const evaluation = payload?.evaluation, details = payload?.website_metadata;
      const fields = ['profile_id', 'team_display_name', 'model_id', 'model_version', 'model_endpoint', 'model_api_key'];
      const metadataFields = ['organization', 'email', 'contact_method', 'contact_value', 'submission_type'];
      if (!evaluation || Object.keys(evaluation).length !== 6 || fields.some(field => typeof evaluation[field] !== 'string' || !evaluation[field].trim()) ||
          !details || metadataFields.some(field => typeof details[field] !== 'string' || !details[field].trim()) ||
          !['agent', 'model'].includes(details.submission_type) || !['phone', 'wechat'].includes(details.contact_method) || evaluation.profile_id !== profile) return json({ error: 'Invalid submission' }, 422);
      let endpoint;
      try { endpoint = new URL(evaluation.model_endpoint); } catch { return json({ error: 'Invalid endpoint' }, 422); }
      if (endpoint.protocol !== 'https:' || (endpoint.port && endpoint.port !== '443') || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return json({ error: 'Invalid endpoint' }, 422);
      const key = headers.get('Idempotency-Key');
      if (!key || key.length > 128) return json({ error: 'Idempotency key required' }, 400);
      const fingerprint = JSON.stringify(payload), previous = attempts.get(key);
      if (previous) return previous.fingerprint === fingerprint ? json(copy(previous.record), 202) : json({ error: 'Idempotency conflict' }, 409);
      const item = { evaluation_id: `demo-evaluation-${records.length + 1}`, profile_id: profile, team_display_name: evaluation.team_display_name,
        model_id: evaluation.model_id, model_version: evaluation.model_version, status: 'QUEUED', completed_episodes: 0, score: null,
        score_kind: 'protocol', official_score: null, eligible_for_ranking: false, finished_at: null, videos_expires_at: null,
        website_metadata: { organization: details.organization, submission_type: details.submission_type } };
      metadata.set(item.evaluation_id, copy(details)); records.unshift(item); polls.set(item.evaluation_id, 0);
      attempts.set(key, { fingerprint, record: item }); return json(copy(item), 202);
    }
    const match = /^\/api\/v1\/evaluations\/([^/]+)(?:\/(tasks|videos|cancel))?$/.exec(path);
    if (match) {
      const item = records.find(record => record.evaluation_id === decodeURIComponent(match[1]));
      if (!item) return json({ error: 'Not found' }, 404);
      if (match[2] === 'cancel' && method === 'POST') {
        if (['QUEUED', 'RUNNING'].includes(item.status)) Object.assign(item, { status: 'CANCELLED', finished_at: now(), videos_expires_at: now() + 7 * 86400 });
        return json(copy(item));
      }
      if (method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      if (match[2] === 'tasks') return json({ tasks: taskRows(item) });
      if (match[2] === 'videos') return json({ videos: item.status === 'COMPLETED' ? videos(item) : [], next_cursor: null });
      if (polls.has(item.evaluation_id) && ['QUEUED', 'RUNNING'].includes(item.status)) {
        const count = polls.get(item.evaluation_id) + 1; polls.set(item.evaluation_id, count);
        Object.assign(item, count < 2 ? { status: 'RUNNING', completed_episodes: 240 } : { status: 'COMPLETED', completed_episodes: 720, score: 84.5,
          eligible_for_ranking: true, finished_at: now(), videos_expires_at: now() + 7 * 86400 });
      }
      return json({ ...copy(item), website_metadata: copy(metadata.get(item.evaluation_id)) });
    }
    return json({ error: 'Demo endpoint not found' }, 404);
  };
})();