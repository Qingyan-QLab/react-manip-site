// One public configuration for the GitHub-hosted account and records pages.
(() => {
  'use strict';
  const config = window.ReactManipSiteConfig;
  let apiOrigin = '', recordsOrigin = '', configurationError = false;
  const inSite = host => host === 'qlab-ai.org' || host.endsWith('.qlab-ai.org');
  try {
    if (!config || typeof config.apiOrigin !== 'string' || typeof config.submissionsEnabled !== 'boolean') throw new Error();
    const value = config.apiOrigin.trim();
    if (value) {
      const url = new URL(value);
      // The existing backend uses SameSite=Lax cookies. Keep both HTTPS hosts
      // under qlab-ai.org; a github.io / trycloudflare.com pairing needs a different
      // session design. Do not accept destinations from query strings or storage.
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
          url.pathname !== '/' || url.port || !inSite(url.hostname) ||
          location.protocol !== 'https:' || !inSite(location.hostname)) throw new Error();
      apiOrigin = url.origin;
    }
    if (config.recordsOrigin !== undefined && typeof config.recordsOrigin !== 'string') throw new Error();
    const records = config.recordsOrigin?.trim() || apiOrigin;
    if (records) {
      const url = new URL(records);
      const allowedHost = inSite(url.hostname) || /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/.test(url.hostname);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
          url.pathname !== '/' || url.port || !allowedHost ||
          location.protocol !== 'https:' || !inSite(location.hostname)) throw new Error();
      recordsOrigin = url.origin;
    }
  } catch { apiOrigin = ''; recordsOrigin = ''; configurationError = true; }
  const submissionsEnabled = Boolean(apiOrigin && config?.submissionsEnabled === true);
  const message = configurationError ? 'The evaluation service configuration needs attention. Please contact the organizers.'
    : !apiOrigin && recordsOrigin ? 'Published records are available. Sign-in and new evaluations are not connected yet.'
    : !apiOrigin ? 'The evaluation service is not connected yet. Sign-in and new evaluations are unavailable.'
    : !submissionsEnabled ? 'New evaluations are paused. You can sign in to view your private records.'
    : 'Sign in to submit an evaluation or view your private records.';
  // Clear both metadata values on an invalid or missing configuration; never
  // fall back to a legacy address embedded in a copied page.
  for (const name of ['website-api', 'website-rankings']) {
    const meta = document.querySelector(`meta[name="${name}"]`);
    if (meta) meta.content = name === 'website-rankings' ? recordsOrigin : apiOrigin;
  }
  const state = document.querySelector('#service-state');
  if (state) { state.textContent = message; state.dataset.state = configurationError ? 'error' : ''; }
  window.ReactManipSite = Object.freeze({ apiOrigin, recordsOrigin, recordsConfigured: Boolean(recordsOrigin), configured: Boolean(apiOrigin), submissionsEnabled, configurationError, message });
})();
