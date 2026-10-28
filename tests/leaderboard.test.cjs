const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

let browser, server, origin;
const root = path.resolve(__dirname, '..');
const artifacts = path.resolve(process.env.TEST_ARTIFACTS || path.join(root, '.cache/browser-checks'));
before(async () => {
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) return res.writeHead(403).end();
    try {
      const data = await fs.readFile(file);
      res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream');
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  await fs.mkdir(path.join(artifacts, ''), { recursive: true });
});
after(async () => { await browser?.close(); await new Promise((resolve) => server?.close(resolve)); });

async function setup(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, ...options });
  context.setDefaultTimeout(10000);
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'No uncaught browser errors'));
  await page.route('https://quotient-lab.github.io/**', (route) => route.abort());
  return page;
}
const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
const profile = { team_name: 'Example team', organization: 'Example University', policy_name: 'example_policy_v1', email: 'researcher@example.com', contact_method: 'phone', contact_value: '+8613800000000' };
async function fillApi(page, value) {
  if (!await page.locator('#connection-settings').evaluate(el => el.open)) await page.locator('#connection-settings summary').click();
  await page.locator('#leaderboard-api-url').fill(value);
}
async function fillProfile(page) {
  for (const name of ['team_name', 'organization', 'policy_name', 'email']) await page.locator('[name="' + name + '"]').fill(profile[name]);
  await page.locator('#contact-method').selectOption(profile.contact_method);
  await page.locator('#contact-value').fill('+86 138 0000 0000');
}
async function fillSubmission(page, type = 'agent') {
  await fillProfile(page);
  await fillApi(page, 'https://evaluation.test');
  await page.locator('#leaderboard-token').fill('test-token');
  await page.locator('#leaderboard-id').fill('board / 2026');
  await page.locator('#evaluation-id').fill('eval_001');
  if (type) await page.getByRole('radio', { name: type === 'agent' ? 'Agent' : 'Model', exact: false }).check();
}
async function messageContains(page, selector, text) {
  await page.locator(selector).filter({ hasText: text }).waitFor();
}

test('main leaderboard contains rankings and a single submission action', async (t) => {
  const page = await setup(t);
  await page.goto(`${origin}/index.html#leaderboard`);
  assert.equal(await page.locator('#leaderboard input').count(), 0);
  assert.equal(await page.locator('#leaderboard button').count(), 0);
  assert.equal(await page.locator('#leaderboard a').count(), 1);
  assert.deepEqual(await page.locator('#leaderboard th').allTextContents(), ['Rank', 'Category', 'Leaderboard ID', 'Score']);
  await page.locator('#leaderboard').screenshot({ path: path.join(artifacts, '/leaderboard-desktop.png') });
  await page.locator('#leaderboard-submit-link').click();
  await page.waitForURL('**/submit.html?leaderboard_id=*');
  assert.equal(await page.locator('#submission-panel').isVisible(), true);
  assert.equal(await page.locator('#records-panel').isVisible(), false);
  await page.screenshot({ path: path.join(artifacts, '/submission-desktop.png'), fullPage: true });
});

test('required type, encoded POST, status polling, and authenticated return to rankings', async (t) => {
  const page = await setup(t);
  const displayName = 'ReAct-Manip Research Agent — Long-Horizon Adaptive Manipulation v2026';
  await page.clock.install();
  const submissions = [], lookups = [];
  let pollCount = 0;
  await page.route('https://evaluation.test/api/v1/**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      submissions.push(req);
      return json(route, { evaluation_id: 'eval_001', status: 'queued' }, 202);
    }
    lookups.push(req);
    if (req.url().endsWith('/rankings')) return json(route, { rankings: [{ leaderboard_id: displayName, nickname: 'Demo agent', name: 'internal-agent-v1', submission_type: 'agent', score: 0, recovery: 0.123456, latency_ms: 987654, updated_at: '2099-12-31T23:59:00Z' }] });
    pollCount++;
    return json(route, { evaluation_id: 'eval_001', status: pollCount === 1 ? 'running' : 'completed' });
  });
  await page.goto(`${origin}/submit.html`);
  await fillSubmission(page, null);
  await page.locator('#submit-evaluation').click();
  assert.equal(submissions.length, 0);
  await page.locator('input[value="agent"]').check();
  await page.locator('#submit-evaluation').click();
  await messageContains(page, '#evaluation-state', 'Evaluation submitted');
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].url(), 'https://evaluation.test/api/v1/leaderboards/board%20%2F%202026/evaluations');
  assert.deepEqual(submissions[0].postDataJSON(), { evaluation_id: 'eval_001', submission_type: 'agent', ...profile });
  assert.equal(submissions[0].headers().authorization, 'Bearer test-token');
  await page.clock.runFor(5100);
  await messageContains(page, '#evaluation-state', 'running');
  await page.clock.runFor(5100);
  await messageContains(page, '#evaluation-state', 'completed');
  await page.clock.runFor(15000);
  assert.equal(pollCount, 2, 'Terminal status stops polling');
  await page.locator('.evaluation-back').click();
  await messageContains(page, '#leaderboard-body', displayName);
  assert.equal(await page.locator('.model-name strong').innerText(), displayName);
  assert.equal(await page.locator('#leaderboard-body td').nth(1).innerText(), 'Agent');
  assert.equal(lookups.at(-1).headers().authorization, 'Bearer test-token');
  assert.equal(await page.locator('.score-value').innerText(), '0');
  assert.equal(await page.locator('#leaderboard-body td').count(), 4);
  const tableWidth = await page.locator('.live-leaderboard').evaluate((table) => table.getBoundingClientRect().width);
  const nameWidth = await page.locator('#leaderboard-body td').nth(2).evaluate((cell) => cell.getBoundingClientRect().width);
  assert.ok(nameWidth / tableWidth > 0.64, 'Leaderboard ID has most of the table width');
  await page.locator('#leaderboard').screenshot({ path: path.join(artifacts, '/leaderboard-four-columns-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.ok(await page.locator('#leaderboard .leaderboard-table-wrap').evaluate((wrap) => wrap.scrollWidth > wrap.clientWidth));
  await page.locator('#leaderboard').screenshot({ path: path.join(artifacts, '/leaderboard-four-columns-mobile.png') });
  assert.doesNotMatch(await page.locator('#leaderboard').innerHTML(), /Recovery|Latency|Updated|0\.123456|987654|2099/);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  assert.equal(page.url().includes('test-token'), false);
});

test('participant API endpoint is sent with the evaluation submission', async (t) => {
  const page = await setup(t);
  let submitted;
  await page.route('https://evaluation.test/api/v1/**', async (route) => {
    if (route.request().method() === 'POST') {
      submitted = route.request().postDataJSON();
      return json(route, { evaluation_id: 'eval_api', status: 'completed' }, 202);
    }
    return json(route, { evaluation_id: 'eval_api', status: 'completed' });
  });
  await page.goto(`${origin}/submit.html`);
  await fillSubmission(page);
  await page.locator('#evaluation-id').fill('eval_api');
  await page.locator('#participant-api-url').fill('https://agent.example.com/v1/');
  await page.locator('#submit-evaluation').click();
  await messageContains(page, '#evaluation-state', 'Evaluation completed');
  assert.deepEqual(submitted, {
    evaluation_id: 'eval_api',
    submission_type: 'agent',
    participant_endpoint: 'https://agent.example.com/v1',
    ...profile
  });
});

test('records search, pagination, safe text, details, empty and error states', async (t) => {
  const page = await setup(t);
  const requests = [];
  await page.route('https://evaluation.test/api/v1/**', async (route) => {
    requests.push(route.request().url());
    const url = route.request().url();
    if (url.includes('/evaluations/eval_002')) return json(route, { evaluation_id: 'eval_002', status: 'completed', score: 89 });
    if (url.includes('/empty/')) return json(route, { evaluations: [] });
    if (url.includes('/denied/')) return json(route, {}, 403);
    if (url.includes('/malformed/')) return json(route, { wrong: [] });
    if (url.includes('?cursor=')) return json(route, { evaluations: [{ evaluation_id: 'eval_002', submission_type: 'model', status: 'running', score: null }], next_cursor: null });
    return json(route, { evaluations: [{ evaluation_id: '<img src=x onerror=alert(1)>', submission_type: 'agent', status: 'completed', score: 92, created_at: '2026-10-14T01:00:00Z' }], next_cursor: 'next / page' });
  });
  await page.goto(`${origin}/submit.html#records`);
  await fillApi(page, 'https://evaluation.test');
  await page.locator('#records-leaderboard-id').fill('board / 2026');
  await page.locator('#load-evaluation-records').click();
  await messageContains(page, '#records-count', '1 record');
  assert.equal(await page.locator('#evaluation-records-body img').count(), 0);
  await page.locator('#records-load-more').click();
  await messageContains(page, '#records-count', '2 records');
  assert.equal(requests[1], 'https://evaluation.test/api/v1/leaderboards/board%20%2F%202026/evaluations?cursor=next%20%2F%20page');
  await page.getByRole('button', { name: 'eval_002', exact: true }).click();
  await messageContains(page, '#record-detail-state', 'completed');
  await page.screenshot({ path: path.join(artifacts, '/records-desktop.png'), fullPage: true });
  for (const [board, expected] of [['empty', 'No records'], ['denied', 'Could not load'], ['malformed', 'Could not load']]) {
    await page.locator('#records-leaderboard-id').fill(board);
    await page.locator('#load-evaluation-records').click();
    await messageContains(page, '#evaluation-records-body', expected);
    assert.equal(await page.locator('#records-load-more').isVisible(), false);
  }
  await page.locator('#records-tab').focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#submission-panel').isVisible(), true);
  assert.equal(await page.locator('#submission-tab').getAttribute('aria-selected'), 'true');
});

test('changing search cancels stale responses and clears pagination', async (t) => {
  const page = await setup(t);
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let requested;
  const started = new Promise((resolve) => { requested = resolve; });
  await page.route('https://evaluation.test/api/v1/**', async (route) => {
    if (route.request().url().includes('/old/')) {
      requested();
      await blocked;
      return json(route, { evaluations: [{ evaluation_id: 'stale_record', status: 'queued' }], next_cursor: 'stale' }).catch(() => {});
    }
    return json(route, { evaluations: [{ evaluation_id: 'fresh_record', status: 'completed' }] });
  });
  await page.goto(`${origin}/submit.html#records`);
  await fillApi(page, 'https://evaluation.test');
  await page.locator('#records-leaderboard-id').fill('old');
  await page.locator('#load-evaluation-records').click();
  await started;
  await page.locator('#records-leaderboard-id').fill('new');
  await page.locator('#load-evaluation-records').click();
  await messageContains(page, '#evaluation-records-body', 'fresh_record');
  release();
  assert.equal(await page.locator('#evaluation-records-body').innerText().then((text) => text.includes('stale_record')), false);
  assert.equal(await page.locator('#records-load-more').isVisible(), false);
});

test('model submissions, duplicate click guard, error recovery and terminal initial response', async (t) => {
  const page = await setup(t);
  await page.clock.install();
  let status = 401, calls = 0, getCalls = 0;
  await page.route('https://evaluation.test/api/v1/**', async (route) => {
    if (route.request().method() !== 'POST') { getCalls++; return json(route, {}); }
    calls++;
    assert.equal(route.request().postDataJSON().submission_type, 'model');
    return json(route, { evaluation_id: 'eval_001', status: 'completed' }, status);
  });
  await page.goto(`${origin}/submit.html`);
  await fillSubmission(page, 'model');
  await page.locator('#submit-evaluation').click();
  await messageContains(page, '#evaluation-state', 'Authentication required');
  assert.equal(await page.locator('#submit-evaluation').isEnabled(), true);
  status = 202;
  await page.locator('#submission-form').evaluate((form) => { form.requestSubmit(); form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); });
  await messageContains(page, '#evaluation-state', 'completed');
  assert.equal(calls, 2, 'Two total POSTs, including the failed attempt');
  await page.clock.runFor(20000);
  assert.equal(getCalls, 0, 'No polling for an initially completed evaluation');
  await page.locator('#leaderboard-token').fill('');
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('react-manip.leaderboard.connection')).token), '');
});

test('fixed deployment configuration keeps records board searchable', async (t) => {
  const page = await setup(t);
  await page.route('**/submit.html', async (route) => {
    const body = (await fs.readFile(path.join(root, 'submit.html'), 'utf8')).replace('name="leaderboard-api" content=""', 'name="leaderboard-api" content="https://evaluation.test"');
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body });
  });
  let requestUrl;
  await page.route('https://evaluation.test/**', (route) => { requestUrl = route.request().url(); return json(route, []); });
  await page.goto(`${origin}/submit.html#records`);
  assert.equal(await page.locator('#leaderboard-api-url').getAttribute('readonly'), '');
  assert.equal(await page.locator('#leaderboard-id').getAttribute('readonly'), '');
  await page.locator('#records-leaderboard-id').fill('another-board');
  await page.locator('#load-evaluation-records').click();
  await messageContains(page, '#evaluation-records-body', 'No records');
  assert.equal(requestUrl, 'https://evaluation.test/api/v1/leaderboards/another-board/evaluations');
});

test('mobile layouts fit the viewport and maintain working tabs', async (t) => {
  const page = await setup(t, { viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
  await page.goto(`${origin}/submit.html`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(artifacts, '/submission-mobile.png'), fullPage: true });
  await page.locator('#records-tab').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(artifacts, '/records-mobile.png'), fullPage: true });
});

test('clearing the API URL never falls back to a saved endpoint', async (t) => {
  const page = await setup(t);
  let requests = 0;
  await page.route('https://evaluation.test/**', (route) => { requests++; return json(route, []); });
  await page.goto(`${origin}/submit.html#records`);
  await fillApi(page, 'https://evaluation.test');
  await page.locator('#load-evaluation-records').click();
  await messageContains(page, '#records-state', 'Evaluation records for');
  await fillApi(page, '');
  await page.locator('#load-evaluation-records').click();
  await messageContains(page, '#records-state', 'Enter the API base URL');
  assert.equal(requests, 1);
  await page.locator('#submission-tab').click();
  await page.locator('#connection-settings summary').click();
  await page.locator('#submit-evaluation').click();
  assert.equal(await page.locator('#connection-settings').getAttribute('open'), '');
});

test('rankings recover automatically after a request timeout', async (t) => {
  const page = await setup(t);
  await page.clock.install();
  await page.addInitScript(() => sessionStorage.setItem('react-manip.leaderboard.connection', JSON.stringify({ base: 'https://evaluation.test', board: 'retry-board' })));
  let requests = 0;
  await page.route('https://evaluation.test/**', (route) => {
    requests++;
    if (requests === 1) return;
    return json(route, [{ name: 'Recovered model', type: 'model', score: 80 }]);
  });
  await page.goto(`${origin}/index.html#leaderboard`);
  await page.clock.runFor(15100);
  await messageContains(page, '#leaderboard-status', 'took too long');
  await page.clock.runFor(8100);
  await messageContains(page, '#leaderboard-body', 'Recovered model');
  assert.equal(await page.locator('#leaderboard-body td').nth(1).innerText(), 'Model');
  assert.equal(requests, 2);
});

test('evaluation polling resumes after page restore', async (t) => {
  const page = await setup(t);
  await page.clock.install();
  let polls = 0;
  await page.route('https://evaluation.test/**', (route) => {
    if (route.request().method() === 'POST') return json(route, { evaluation_id: 'eval_001', status: 'queued' }, 202);
    polls++;
    return json(route, { evaluation_id: 'eval_001', status: 'completed' });
  });
  await page.goto(`${origin}/submit.html`);
  await fillSubmission(page);
  await page.locator('#submit-evaluation').click();
  await messageContains(page, '#evaluation-state', 'Evaluation submitted');
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.clock.runFor(10100);
  assert.equal(polls, 0);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await messageContains(page, '#evaluation-state', 'completed');
  assert.equal(polls, 1);
});

async function openSimulationEvaluation(page) {
  await page.goto(`${origin}/submit.html#records`);
  await fillApi(page, 'https://evaluation.test');
  await page.locator('#load-evaluation-records').click();
  await page.getByRole('button', { name: 'eval / A', exact: true }).click();
  await messageContains(page, '#record-detail-state', 'completed');
}

test('diagnostics load only through evaluation, run, video, and optional details', async (t) => {
  const page = await setup(t);
  const urls = [], mediaRequests = [];
  // A short local video fixture exercises an actual playable stream, without
  // downloading or substituting any production evaluation footage.
  const videoBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 270;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const done = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start();
    for (let frame = 0; frame < 4; frame++) {
      ctx.fillStyle = '#172f40'; ctx.fillRect(0, 0, 480, 270);
      ctx.fillStyle = '#e2e9ef'; ctx.font = '18px sans-serif'; ctx.fillText('Simulation video · test fixture', 28, 40);
      ctx.fillStyle = '#5c94cc'; ctx.fillRect(70 + frame * 20, 110, 44, 44);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    recorder.stop(); await done; stream.getTracks().forEach((track) => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  await page.route('https://media.test/**', (route) => { mediaRequests.push(route.request().url()); return route.fulfill({ contentType: 'video/webm', body: Buffer.from(videoBytes) }); });
  await page.route('https://evaluation.test/**', (route) => {
    const url = route.request().url();
    urls.push(url);
    if (url.endsWith('/metrics')) return json(route, { metrics: { recovery: 0, latency_ms: 0, updated_at: '2026-10-14T01:00:00Z' } });
    if (url.endsWith('/simulations/run%20%2F%201')) return json(route, { simulation_id: 'run / 1', video_url: 'https://media.test/run1.webm' });
    if (url.includes('/simulations?cursor=')) return json(route, { simulations: [{ simulation_id: 'run2', task_name: 'Second task' }] });
    if (url.endsWith('/simulations')) return json(route, { simulations: [{ simulation_id: 'run / 1', task_name: 'Ball to Target Hole', recovery: 'not-visible', latency_ms: 765432 }], next_cursor: 'next / run' });
    if (url.includes('/evaluations/eval%20%2F%20A')) return json(route, { evaluation_id: 'eval / A', status: 'completed', recovery: 'not-visible' });
    return json(route, { evaluations: [{ evaluation_id: 'eval / A', status: 'completed', submission_type: 'agent', score: 90, updated_at: '2099-12-31', recovery: 'not-visible' }] });
  });
  await openSimulationEvaluation(page);
  assert.deepEqual(await page.locator('.evaluation-records th').allTextContents(), ['Evaluation ID', 'Type', 'Status', 'Score']);
  assert.equal(urls.some((url) => url.includes('/simulations')), false);
  await page.locator('#simulation-records > summary').click();
  await page.locator('.simulation-run').waitFor();
  assert.equal(await page.locator('video').count(), 1);
  assert.equal(await page.locator('video').getAttribute('src'), null);
  assert.doesNotMatch(await page.locator('#records-panel').innerHTML(), /not-visible|765432|2099-12-31|<dt>Recovery/);
  await page.locator('.simulation-run > summary').click();
  assert.equal(urls.filter((url) => url.includes('/simulations')).length, 1);
  await page.locator('.simulation-video > summary').click();
  await page.waitForFunction(() => document.querySelector('.simulation-player').hasAttribute('src'));
  await page.waitForFunction(() => document.querySelector('.simulation-player').readyState >= 2);
  assert.equal(mediaRequests.length > 0, true);
  await page.locator('video').evaluate(async (video) => { await video.play(); video.pause(); });
  assert.equal(urls.some((url) => url.endsWith('/metrics')), false);
  assert.equal(await page.locator('.simulation-metric-list').innerHTML(), '');
  assert.equal(await page.locator('video').evaluate((video) => video.autoplay), false);
  await page.locator('.simulation-metrics > summary').click();
  await messageContains(page, '.simulation-metric-list', 'Recovery');
  assert.deepEqual(await page.locator('.simulation-metric-list dd').allTextContents().then((x) => x.slice(0, 4)), ['eval / A', 'run / 1', '0', '0 ms']);
  assert.equal(urls.at(-1), 'https://evaluation.test/api/v1/evaluations/eval%20%2F%20A/simulations/run%20%2F%201/metrics');
  await page.locator('#record-detail').screenshot({ path: path.join(artifacts, '/simulation-details-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#record-detail').screenshot({ path: path.join(artifacts, '/simulation-details-mobile.png') });
  await page.locator('.simulation-video > summary').click();
  await page.waitForFunction(() => !document.querySelector('video').hasAttribute('src') && document.querySelector('.simulation-metric-list').childElementCount === 0);
  await page.locator('#simulations-load-more').click();
  await page.locator('.simulation-run').nth(1).waitFor();
  assert.equal(urls.at(-1), 'https://evaluation.test/api/v1/evaluations/eval%20%2F%20A/simulations?cursor=next%20%2F%20run');
  assert.equal(await page.locator('#simulations-load-more').isVisible(), false);
  await page.locator('#submission-tab').click();
  assert.equal(await page.locator('.simulation-run').count(), 0);
  assert.equal(await page.locator('#simulation-records').getAttribute('open'), null);
});

test('stale metrics are discarded when the selected evaluation changes', async (t) => {
  const page = await setup(t);
  let release, started;
  const blocked = new Promise((resolve) => { release = resolve; });
  const requested = new Promise((resolve) => { started = resolve; });
  await page.route('https://evaluation.test/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/metrics')) {
      started(); await blocked;
      return json(route, { metrics: { recovery: 'stale-metric' } }).catch(() => {});
    }
    if (url.endsWith('/simulations/run1')) return json(route, { video_url: null });
    if (url.endsWith('/simulations')) return json(route, { simulations: [{ simulation_id: 'run1', task_name: 'Task one' }] });
    if (url.includes('/evaluations/eval')) return json(route, { status: 'completed' });
    return json(route, { evaluations: [{ evaluation_id: 'eval / A', status: 'completed' }, { evaluation_id: 'eval_B', status: 'completed' }] });
  });
  await openSimulationEvaluation(page);
  await page.locator('#simulation-records > summary').click();
  await page.locator('.simulation-run > summary').click();
  await page.locator('.simulation-video > summary').click();
  await messageContains(page, '.simulation-video-state', 'No video');
  await page.locator('.simulation-metrics > summary').click();
  await requested;
  await page.getByRole('button', { name: 'eval_B', exact: true }).click();
  release();
  await messageContains(page, '#record-detail-state', 'completed');
  assert.equal(await page.locator('#record-detail-title').innerText(), 'eval_B');
  assert.equal(await page.locator('.simulation-run').count(), 0);
  assert.doesNotMatch(await page.locator('#records-panel').innerHTML(), /stale-metric/);
});

test('simulation errors, missing videos and denied metrics remain scoped to optional sections', async (t) => {
  const page = await setup(t);
  let listMode = 'error', videoMode = 'unsafe', metricMode = 'denied';
  await page.route('https://evaluation.test/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/metrics')) return metricMode === 'denied' ? json(route, {}, 403) : json(route, { metrics: {} });
    if (url.endsWith('/simulations/run1')) return json(route, { video_url: videoMode === 'unsafe' ? 'javascript:alert(1)' : null });
    if (url.endsWith('/simulations')) {
      if (listMode === 'error') return json(route, {}, 503);
      return json(route, { simulations: listMode === 'empty' ? [] : [{ simulation_id: 'run1', task_name: '<img src=x onerror=alert(1)>' }] });
    }
    if (url.includes('/evaluations/eval')) return json(route, { status: 'completed' });
    return json(route, { evaluations: [{ evaluation_id: 'eval / A', status: 'completed' }] });
  });
  await openSimulationEvaluation(page);
  await page.locator('#simulation-records > summary').click();
  await messageContains(page, '#simulation-records-state', 'Could not load');
  await page.locator('#simulation-records > summary').click();
  listMode = 'empty';
  await page.locator('#simulation-records > summary').click();
  await messageContains(page, '#simulation-records-state', 'No simulation records');
  await page.locator('#simulation-records > summary').click();
  listMode = 'rows';
  await page.locator('#simulation-records > summary').click();
  await page.locator('.simulation-run > summary').click();
  assert.equal(await page.locator('#simulation-records-list img').count(), 0);
  await page.locator('.simulation-video > summary').click();
  await messageContains(page, '.simulation-video-state', 'No video');
  assert.equal(await page.locator('video').getAttribute('src'), null);
  await page.locator('.simulation-metrics > summary').click();
  await messageContains(page, '.simulation-metrics-state', 'current access');
  assert.equal(await page.locator('.simulation-metric-list').innerHTML(), '');
  metricMode = 'empty';
  await page.locator('.simulation-metrics > summary').click();
  await page.locator('.simulation-metrics > summary').click();
  await messageContains(page, '.simulation-metrics-state', 'not been provided');
  assert.equal(await page.locator('.simulation-metric-list dd').nth(2).innerText(), '—');
  await page.locator('#records-leaderboard-id').fill('other');
  assert.equal(await page.locator('#record-detail').isVisible(), false);
  assert.equal(await page.locator('.simulation-run').count(), 0);
});

test('required profile fields and invalid contact details block submission', async (t) => {
  const page = await setup(t);
  let posts = 0;
  await page.route('https://evaluation.test/**', route => { posts++; return json(route, { status: 'completed' }); });
  await page.goto(`${origin}/submit.html`);
  await fillSubmission(page);
  for (const name of ['team_name', 'organization', 'policy_name', 'email', 'contact_value']) {
    const field = page.locator(`[name="${name}"]`);
    const previous = await field.inputValue();
    await field.fill('');
    await page.locator('#submit-evaluation').click();
    assert.equal(posts, 0, `${name} is required`);
    assert.equal(await field.evaluate(el => el.validity.valid), false);
    await field.fill(previous);
  }
  for (const [selector, value] of [['#team-name', '   '], ['#contact-email', 'not-an-email'], ['#contact-value', 'abc123'], ['#contact-value', '123'], ['#contact-value', '+1234567890123456']]) {
    const field = page.locator(selector);
    const previous = await field.inputValue();
    await field.fill(value);
    await page.locator('#submit-evaluation').click();
    assert.equal(posts, 0, `${selector} rejects ${value}`);
    assert.equal(await field.evaluate(el => el.validity.valid), false);
    await field.fill(previous);
  }
  await page.locator('#contact-value').fill('');
  await page.locator('#submission-form').evaluate(form => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
  assert.equal(posts, 0, 'Submit handler also validates programmatic submissions');
});

test('contact switching keeps separate drafts and sends the selected WeChat contact', async (t) => {
  const page = await setup(t);
  let submitted;
  await page.route('https://evaluation.test/**', route => {
    submitted = route.request().postDataJSON();
    return json(route, { evaluation_id: 'eval_001', status: 'completed' });
  });
  await page.goto(`${origin}/submit.html`);
  await fillSubmission(page);
  await page.locator('#contact-method').selectOption('wechat');
  assert.equal(await page.locator('#contact-value').inputValue(), '');
  assert.equal(await page.locator('#contact-value').getAttribute('type'), 'text');
  assert.equal(await page.locator('#contact-value-label').innerText(), 'WeChat ID');
  await page.locator('#submit-evaluation').click();
  assert.equal(submitted, undefined);
  await page.locator('#contact-value').fill('invalid wechat');
  await page.locator('#submit-evaluation').click();
  assert.equal(submitted, undefined);
  await page.locator('#contact-value').fill('  example_researcher  ');
  await page.locator('#contact-method').selectOption('phone');
  assert.equal(await page.locator('#contact-value').inputValue(), '+86 138 0000 0000');
  assert.equal(await page.locator('#contact-value').getAttribute('type'), 'tel');
  await page.locator('#contact-method').selectOption('wechat');
  assert.equal(await page.locator('#contact-value').inputValue(), '  example_researcher  ');
  await page.locator('#team-name').fill('  Example team  ');
  await page.locator('#submit-evaluation').click();
  await messageContains(page, '#evaluation-state', 'completed');
  assert.deepEqual(submitted, { evaluation_id: 'eval_001', submission_type: 'agent', ...profile, contact_method: 'wechat', contact_value: 'example_researcher' });
  const stored = await page.evaluate(() => JSON.stringify({ session: { ...sessionStorage }, local: { ...localStorage } }));
  assert.doesNotMatch(stored, /example_researcher|researcher@example.com|13800000000/);
  assert.doesNotMatch(page.url(), /example_researcher|researcher|138/);
});

test('demo accepts complete profiles, rejects missing contacts, and keeps contacts out of public responses', async (t) => {
  const page = await setup(t);
  await page.clock.install();
  await page.goto(`${origin}/submit.html?demo=1`);
  assert.equal(await page.locator('#policy-name').inputValue(), 'sample_policy_v1');
  assert.equal(await page.locator('#contact-value-label').innerText(), 'WeChat ID');
  await page.locator('#submit-evaluation').click();
  await messageContains(page, '#evaluation-state', 'Evaluation submitted');
  await page.clock.runFor(5100);
  await messageContains(page, '#evaluation-state', 'completed');
  const result = await page.evaluate(async () => {
    const base = window.REACT_MANIP_DEMO_API + '/api/v1';
    const rankings = await (await fetch(base + '/leaderboards/react-manip-season-2026/rankings')).json();
    const records = await (await fetch(base + '/leaderboards/react-manip-season-2026/evaluations')).json();
    const evaluation = await (await fetch(base + '/evaluations/react_manip_test')).json();
    const invalid = await fetch(base + '/leaderboards/react-manip-season-2026/evaluations', { method: 'POST', body: JSON.stringify({ evaluation_id: 'missing-contact', submission_type: 'agent' }) });
    return { rankings, records, evaluation, invalidStatus: invalid.status };
  });
  assert.equal(result.invalidStatus, 400);
  assert.equal(result.rankings.rankings[0].leaderboard_id, 'sample_policy_v1');
  assert.equal(result.evaluation.team_name, 'Demo team');
  assert.equal(result.evaluation.organization, 'Independent');
  assert.equal(result.evaluation.policy_name, 'sample_policy_v1');
  assert.doesNotMatch(JSON.stringify(result), /demo_contact|demo@example.com|contact_value|contact_method/);
});

test('profile layout follows the reference on desktop and stacks on narrow screens', async (t) => {
  const page = await setup(t);
  await page.goto(`${origin}/submit.html`);
  assert.deepEqual(await page.locator('.submission-profile > label > span').allTextContents(), ['Team name *', 'Organization *', 'Policy name *', 'Email *', 'Contact method *', 'Phone number *']);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const team = await page.locator('#team-name').boundingBox();
    const organization = await page.locator('#organization').boundingBox();
    if (width > 720) assert.equal(team.y, organization.y);
    else { assert.equal(team.x, organization.x); assert(organization.y > team.y); }
    if (width === 1440 || width === 390) {
      await page.locator('#submission-panel').screenshot({ path: path.join(artifacts, `submission-form-${width}.png`) });
    }
  }
  await page.locator('#contact-method').selectOption('wechat');
  await page.locator('#submission-panel').screenshot({ path: path.join(artifacts, 'submission-wechat-mobile.png') });
});
