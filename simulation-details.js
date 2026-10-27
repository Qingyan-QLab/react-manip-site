// Simulation media and diagnostic metrics are fetched only after each explicit
// disclosure step. No diagnostic values are rendered in rankings or run lists.
(() => {
  'use strict';
  const root = document.querySelector('#simulation-records');
  if (!root) return;
  const list = document.querySelector('#simulation-records-list');
  const message = document.querySelector('#simulation-records-state');
  const more = document.querySelector('#simulations-load-more');
  const requests = new Map();
  let selection = null;
  let generation = 0;
  let nextCursor = null;
  let runCount = 0;
  let listLoaded = false;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const setMessage = (node, text, error = false) => {
    node.textContent = text;
    node.dataset.state = error ? 'error' : '';
  };
  const abort = (key) => {
    requests.get(key)?.abort();
    requests.delete(key);
  };
  const releaseVideo = (video) => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.hidden = true;
  };
  const conceal = () => {
    generation++;
    for (const key of requests.keys()) abort(key);
    root.querySelectorAll('video').forEach(releaseVideo);
    root.querySelectorAll('details').forEach((details) => { details.open = false; });
    root.open = false;
    list.replaceChildren();
    nextCursor = null;
    runCount = 0;
    listLoaded = false;
    more.hidden = true;
    more.disabled = false;
    list.removeAttribute('aria-busy');
    setMessage(message, 'Open to view simulation runs for this evaluation.');
  };
  const fetchJson = async (path, context, key) => {
    abort(key);
    const controller = new AbortController();
    requests.set(key, controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    const headers = { Accept: 'application/json' };
    if (context.config.token) headers.Authorization = /^bearer /i.test(context.config.token) ? context.config.token : `Bearer ${context.config.token}`;
    try {
      const response = await fetch(`${context.config.base}/api/v1${path}`, { headers, signal: controller.signal, cache: 'no-store' });
      if (!response.ok) {
        const messages = { 401: 'Sign in through Connection settings to view this record.', 403: 'This record is not available with your current access.', 404: 'This record is not available yet.', 429: 'Too many requests. Please try again shortly.' };
        throw new Error(messages[response.status] || `Could not load this record (${response.status}).`);
      }
      let data;
      try { data = await response.json(); } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error('The evaluation service returned an invalid response.');
      }
      if (controller.signal.aborted || context.generation !== generation) throw new DOMException('Request cancelled', 'AbortError');
      return data;
    } catch (error) {
      if (timedOut) throw new Error('The evaluation service took too long to respond. Close and reopen this section to retry.');
      if (error.name === 'TypeError') throw new Error('Could not reach the evaluation service. Close and reopen this section to retry.');
      throw error;
    } finally {
      clearTimeout(timer);
      if (requests.get(key) === controller) requests.delete(key);
    }
  };
  const objectFrom = (data, key) => {
    const value = data?.[key] ?? data?.data?.[key] ?? data?.data ?? data;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The evaluation service returned an invalid record.');
    return value;
  };
  const safeVideoUrl = (value, base) => {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value, `${base}/`);
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  };
  const formatDate = (value) => {
    if (value === undefined || value === null || value === '') return '—';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? String(value) : date.toLocaleString();
  };
  const createRun = (run, context, index) => {
    const id = String(run.simulation_id ?? run.id);
    const rawTaskName = run.task_name || run.name || 'Simulation';
    const taskName = window.REACT_MANIP_TASK_NAME?.(rawTaskName) || rawTaskName;
    const path = `/evaluations/${encodeURIComponent(context.id)}/simulations/${encodeURIComponent(id)}`;
    const videoKey = `video-${context.generation}-${index}`;
    const metricsKey = `metrics-${context.generation}-${index}`;
    const runDetails = element('details', 'simulation-run');
    const summary = element('summary');
    summary.append(element('span', 'simulation-run-number', `Run ${String(index + 1).padStart(2, '0')}`), element('strong', '', taskName));
    const runContent = element('div', 'simulation-run-content');
    const videoDetails = element('details', 'simulation-video');
    videoDetails.append(element('summary', '', 'Watch simulation video'));
    const videoContent = element('div', 'simulation-video-content');
    const videoMessage = element('p', 'simulation-video-state evaluation-message');
    videoMessage.setAttribute('role', 'status');
    const video = element('video', 'simulation-player');
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.hidden = true;
    video.setAttribute('aria-label', `Simulation video for ${taskName}`);
    const metricsDetails = element('details', 'simulation-metrics');
    metricsDetails.append(element('summary', '', 'Additional evaluation details'));
    const metricsContent = element('div', 'simulation-metrics-content');
    const metricsMessage = element('p', 'simulation-metrics-state evaluation-message');
    metricsMessage.setAttribute('role', 'status');
    const metricsList = element('dl', 'simulation-metric-list');
    metricsContent.append(metricsMessage, metricsList);
    metricsDetails.append(metricsContent);
    videoContent.append(videoMessage, video, metricsDetails);
    videoDetails.append(videoContent);
    runContent.append(videoDetails);
    runDetails.append(summary, runContent);

    const hideMetrics = () => {
      abort(metricsKey);
      metricsDetails.open = false;
      metricsList.replaceChildren();
      setMessage(metricsMessage, '');
    };
    const hideVideo = () => {
      abort(videoKey);
      hideMetrics();
      videoDetails.open = false;
      releaseVideo(video);
    };
    video.addEventListener('error', () => {
      if (!videoDetails.open || !video.hasAttribute('src')) return;
      video.hidden = true;
      setMessage(videoMessage, 'This video is currently unavailable. Close and reopen the video section to retry.', true);
    });
    video.addEventListener('loadedmetadata', () => {
      if (videoDetails.open && video.hasAttribute('src')) setMessage(videoMessage, '');
    });
    runDetails.addEventListener('toggle', () => {
      if (!runDetails.open) hideVideo();
      else list.querySelectorAll('.simulation-run').forEach((other) => { if (other !== runDetails) other.open = false; });
    });
    videoDetails.addEventListener('toggle', async () => {
      if (!videoDetails.open) { hideVideo(); return; }
      setMessage(videoMessage, 'Loading simulation video…');
      try {
        const data = objectFrom(await fetchJson(path, context, videoKey), 'simulation');
        if (!videoDetails.open || context.generation !== generation) return;
        const url = safeVideoUrl(data.video_url, context.config.base);
        if (!url) { setMessage(videoMessage, 'No video is available for this simulation yet.'); return; }
        video.src = url;
        video.hidden = false;
        video.load();
        setMessage(videoMessage, 'Select play to watch this simulation.');
      } catch (error) {
        if (error.name !== 'AbortError' && context.generation === generation && videoDetails.open) setMessage(videoMessage, error.message, true);
      }
    });
    metricsDetails.addEventListener('toggle', async () => {
      if (!metricsDetails.open) { hideMetrics(); return; }
      if (!videoDetails.open || !runDetails.open || !root.open) { hideMetrics(); return; }
      metricsList.replaceChildren();
      setMessage(metricsMessage, 'Loading additional evaluation details…');
      try {
        const data = objectFrom(await fetchJson(`${path}/metrics`, context, metricsKey), 'metrics');
        if (!metricsDetails.open || context.generation !== generation) return;
        const recovery = data.recovery ?? data.recovery_score ?? data.delta;
        const latency = data.latency_ms ?? data.latency;
        const updated = data.updated_at ?? data.occurred_at ?? data.created_at;
        const values = [
          ['Evaluation ID', context.id], ['Simulation ID', id], ['Recovery', recovery ?? '—'],
          ['Latency', typeof latency === 'number' ? `${latency} ms` : latency ?? '—'], ['Updated', formatDate(updated)]
        ];
        for (const [label, value] of values) {
          const entry = element('div');
          entry.append(element('dt', '', label), element('dd', '', String(value)));
          metricsList.append(entry);
        }
        setMessage(metricsMessage, recovery == null && latency == null && updated == null ? 'Additional metrics have not been provided for this simulation.' : '');
      } catch (error) {
        if (error.name !== 'AbortError' && context.generation === generation && metricsDetails.open) setMessage(metricsMessage, error.message, true);
      }
    });
    return runDetails;
  };

  const loadRuns = async (append = false) => {
    if (!selection || !root.open) return;
    const context = { ...selection, generation };
    const cursor = append && nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : '';
    const path = `/evaluations/${encodeURIComponent(context.id)}/simulations${cursor}`;
    more.disabled = true;
    list.setAttribute('aria-busy', 'true');
    setMessage(message, 'Loading simulation records…');
    try {
      const data = await fetchJson(path, context, 'runs');
      const rows = Array.isArray(data) ? data : data?.simulations ?? data?.records ?? data?.data;
      if (!Array.isArray(rows) || rows.some((run) => !run || typeof run !== 'object' || !String(run.simulation_id ?? run.id ?? '').trim())) throw new Error('The evaluation service returned an invalid simulation list.');
      if (context.generation !== generation || !root.open) return;
      if (!append) { list.replaceChildren(); runCount = 0; }
      for (const run of rows) list.append(createRun(run, context, runCount++));
      nextCursor = typeof data?.next_cursor === 'string' && data.next_cursor ? data.next_cursor : null;
      listLoaded = true;
      more.hidden = !nextCursor;
      setMessage(message, runCount ? 'Choose a run to view its simulation video.' : 'No simulation records are available for this evaluation yet.');
    } catch (error) {
      if (error.name !== 'AbortError' && context.generation === generation && root.open) setMessage(message, error.message, true);
    } finally {
      if (context.generation === generation) {
        more.disabled = false;
        list.removeAttribute('aria-busy');
      }
    }
  };
  root.addEventListener('toggle', () => {
    if (root.open) { if (!listLoaded) loadRuns(); }
    else conceal();
  });
  more.addEventListener('click', () => loadRuns(true));
  document.addEventListener('evaluation-details-select', (event) => {
    conceal();
    selection = { id: event.detail.id, config: { ...event.detail.config } };
  });
  document.addEventListener('evaluation-details-reset', () => { conceal(); selection = null; });
  document.addEventListener('evaluation-details-conceal', conceal);
  window.addEventListener('pagehide', conceal);
})();
