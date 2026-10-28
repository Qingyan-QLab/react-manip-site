// Local fixture service for reviewing the complete evaluation disclosure flow
// before the real evaluation service is available. The fixture is selected by
// the explicit demo API base below, so the regular submission form can use the
// same API detection path as a deployed evaluator.
(() => {
  'use strict';
  const params = new URLSearchParams(window.location.search);
  const demoMode = params.get('demo') === '1';
  const demoApiBase = 'https://demo.react-manip.local';
  window.REACT_MANIP_DEMO_API = demoApiBase;
  window.REACT_MANIP_LEADERBOARD_DEMO_API = demoApiBase;
  window.REACT_MANIP_LEADERBOARD_DEMO = demoMode;

  // This value is deliberately non-secret and only exists to exercise the
  // authenticated browser flow while the fixture is being reviewed.
  const demoToken = 'demo-react-manip-token-2026';
  window.REACT_MANIP_DEMO_BEARER_TOKEN = demoToken;
  window.REACT_MANIP_DEMO_TOKEN = demoToken;
  window.REACT_MANIP_LEADERBOARD_DEMO_TOKEN = demoToken;
  const tokenInput = document.querySelector('#leaderboard-token');
  if (demoMode && tokenInput && !tokenInput.value) tokenInput.value = demoToken;

  const board = 'react-manip-season-2026';
  const evaluationId = 'react_manip_test';
  window.REACT_MANIP_DEMO_EVALUATION_ID = evaluationId;
  const displayName = 'Sample Agent (Demo Data)';
  const videoBase = new URL('videos/', window.location.href);
  const simulations = window.REACT_MANIP_TASKS.map(({ id: number, name: task_name, video: file }, index) => ({
    simulation_id: `${evaluationId}_sim_${number}`,
    task_name,
    task_id: number,
    video_url: file ? new URL(file, videoBase).href : null,
    metrics: {
      recovery: Number((0.985 - index * 0.006).toFixed(3)),
      latency_ms: 118 + index * 7,
      updated_at: `2026-10-15T08:${String(12 + index).padStart(2, '0')}:00Z`,
      success: true,
      condition: index % 2 ? 'perturbed' : 'nominal',
      seed: 2026 + index,
      steps: 92 + index * 11,
      episode_score: 100
    }
  }));
  const runsForEvaluation = (id) => simulations.map((run) => ({
    ...run,
    simulation_id: `${id}_sim_${run.task_id}`
  }));
  const simulationSummaries = (id) => runsForEvaluation(id).map(({ simulation_id, task_name }) => ({
    simulation_id,
    task_name
  }));
  const evaluations = [{
    evaluation_id: evaluationId,
    submission_type: 'agent',
    status: 'completed',
    score: 100,
    board_id: board,
    display_name: displayName,
    completed_at: '2026-10-15T08:30:00Z'
  }];

  const originalFetch = window.fetch.bind(window);
  const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
  const pathParts = (url) => new URL(url, window.location.href).pathname
    .split('/').filter(Boolean).map(decodeURIComponent);
  const copy = (value) => JSON.parse(JSON.stringify(value));

  const readBody = async (input, init) => {
    if (init && init.body !== undefined && init.body !== null) {
      if (typeof init.body === 'string') {
        try { return JSON.parse(init.body); } catch { return {}; }
      }
      if (typeof init.body === 'object') return init.body;
    }
    if (input && typeof input.clone === 'function') {
      try { return await input.clone().json(); } catch { return {}; }
    }
    return {};
  };

  const saveSubmission = (payload) => {
    const submittedId = String(payload?.evaluation_id || evaluationId).trim() || evaluationId;
    const submittedType = payload?.submission_type === 'model' ? 'model' : 'agent';
    const existing = evaluations.find((item) => item.evaluation_id === submittedId);
    const record = existing || { evaluation_id: submittedId };
    Object.assign(record, {
      submission_type: submittedType,
      status: 'completed',
      score: 100,
      board_id: board,
      display_name: displayName,
      completed_at: '2026-10-15T08:30:00Z'
    });
    if (typeof payload?.participant_endpoint === 'string' && payload.participant_endpoint.trim()) {
      record.participant_endpoint = payload.participant_endpoint.trim();
    }
    if (!existing) evaluations.unshift(record);
    return copy(record);
  };

  window.fetch = async (input, init = {}) => {
    const requestUrl = typeof input === 'string' ? input : input?.url;
    const url = new URL(requestUrl, window.location.href);
    const isDemoRequest = url.origin === new URL(demoApiBase).origin || (demoMode && url.origin === window.location.origin);
    if (!isDemoRequest || !url.pathname.startsWith('/api/v1/')) return originalFetch(input, init);
    const parts = pathParts(url);
    const method = (init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();

    if (parts[2] === 'leaderboards' && parts[4] === 'rankings' && method === 'GET') {
      const ranked = evaluations.find((item) => item.evaluation_id === evaluationId) || evaluations[0];
      return json({ rankings: [{
        rank: 1,
        submission_type: ranked?.submission_type || 'agent',
        leaderboard_id: displayName,
        score: 100,
        evaluation_id: ranked?.evaluation_id || evaluationId
      }] });
    }
    if (parts[2] === 'leaderboards' && parts[4] === 'evaluations' && method === 'GET') {
      return json({ evaluations: copy(evaluations), next_cursor: null });
    }
    if (parts[2] === 'leaderboards' && parts[4] === 'evaluations' && method === 'POST') {
      const record = saveSubmission(await readBody(input, init));
      // Keep the demo on the same asynchronous path as a real evaluator:
      // registration is accepted first, then the status lookup returns the
      // completed sample when the UI polls it.
      return json({ ...record, status: 'queued' }, 202);
    }
    if (parts[2] === 'evaluations' && parts.length === 4 && method === 'GET') {
      const found = evaluations.find((item) => item.evaluation_id === parts[3]);
      return found ? json(copy(found)) : json({ error: 'Evaluation not found' }, 404);
    }
    if (parts[2] === 'evaluations' && parts[4] === 'simulations' && parts.length === 5 && method === 'GET') {
      const found = evaluations.find((item) => item.evaluation_id === parts[3]);
      return found ? json({ simulations: copy(simulationSummaries(parts[3])), next_cursor: null }) : json({ error: 'Evaluation not found' }, 404);
    }
    if (parts[2] === 'evaluations' && parts[4] === 'simulations' && parts.length === 6 && method === 'GET') {
      const run = runsForEvaluation(parts[3]).find((item) => item.simulation_id === parts[5]);
      return run ? json({ simulation_id: run.simulation_id, video_url: run.video_url }) : json({ error: 'Simulation not found' }, 404);
    }
    if (parts[2] === 'evaluations' && parts[4] === 'simulations' && parts[6] === 'metrics' && method === 'GET') {
      const run = runsForEvaluation(parts[3]).find((item) => item.simulation_id === parts[5]);
      return run ? json({ metrics: copy(run.metrics) }) : json({ error: 'Simulation not found' }, 404);
    }
    return json({ error: 'Demo endpoint not found' }, 404);
  };
})();
