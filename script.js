// Keep the hero responsive by loading only the first few videos during the
// first paint, then warming the remaining tiles one at a time when the browser
// is idle. Setting `src` lazily is more reliable than relying on video preload
// hints, which browsers may still interpret as a request for every tile.
const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
const heroMediaVideos = [...document.querySelectorAll('.hero-media video')];
const heroVideos = heroMediaVideos.filter((video) => video.dataset.src);
const reducedDataMode = navigator.connection?.saveData || ['slow-2g', '2g'].includes(navigator.connection?.effectiveType);
const initialHeroVideoCount = prefersReducedMotion ? 0 : reducedDataMode ? 1 : 4;
let nextHeroVideoIndex = 0;

// Respect the user's motion preference even when the browser has already
// started an autoplay video before this script runs. The first frame remains
// available as a static preview, while the user can still play a task video
// from its controls.
if (prefersReducedMotion) {
  heroMediaVideos.forEach((video) => {
    video.removeAttribute('autoplay');
    video.pause();
    video.preload = 'metadata';
  });
}

const loadHeroVideo = (video) => {
  if (!video || video.src) return;
  video.src = video.dataset.src;
  video.addEventListener('canplay', () => video.play().catch(() => {}), { once: true });
  video.addEventListener('error', () => {
    // Retry once with an explicit reload. This helps with a transient range
    // request failure while keeping the rest of the hero queue moving.
    if (video.dataset.retried === 'true') return;
    video.dataset.retried = 'true';
    video.load();
  }, { once: true });
  video.load();
};

const loadNextHeroVideo = () => {
  const video = heroVideos[nextHeroVideoIndex++];
  if (!video) return;
  loadHeroVideo(video);
  if (nextHeroVideoIndex < heroVideos.length) {
    window.setTimeout(loadNextHeroVideo, reducedDataMode ? 1200 : 450);
  }
};

heroVideos.slice(0, initialHeroVideoCount).forEach(loadHeroVideo);
nextHeroVideoIndex = initialHeroVideoCount;
if (!prefersReducedMotion) {
  const scheduleHeroWarmup = window.requestIdleCallback
    ? (callback) => window.requestIdleCallback(callback, { timeout: 1800 })
    : (callback) => window.setTimeout(callback, 900);
  scheduleHeroWarmup(loadNextHeroVideo);
}

// Build the catalog thumbnails from the first useful frame of each demo video.
// The capture is queued and starts only when a card approaches the viewport,
// so the catalog gets real demo imagery without adding 16 video downloads to
// the initial page load.
const taskPreviewCards = [...document.querySelectorAll('.task-spec[data-video]')];
const taskPreviewQueue = [];
let taskPreviewActive = false;

const captureTaskPreview = (card) => new Promise((resolve) => {
  const image = card.querySelector('.task-preview-image');
  const source = card.dataset.video;
  if (!image || !source) { resolve(); return; }
  const video = document.createElement('video');
  let settled = false;
  const cleanup = (captured) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeoutId);
    if (captured) {
      image.classList.add('is-captured');
      image.setAttribute('data-captured', 'true');
    } else {
      image.classList.add('is-unavailable');
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
    resolve();
  };
  const timeoutId = window.setTimeout(() => cleanup(false), 12000);
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.addEventListener('loadedmetadata', () => {
    try {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
      video.currentTime = Math.min(Math.max(duration * .18, .2), 1.5);
    } catch { cleanup(false); }
  }, { once: true });
  video.addEventListener('seeked', () => {
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 960 / (video.videoWidth || 960));
      canvas.width = Math.max(1, Math.round((video.videoWidth || 960) * scale));
      canvas.height = Math.max(1, Math.round((video.videoHeight || 540) * scale));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      image.src = canvas.toDataURL('image/jpeg', .84);
      cleanup(true);
    } catch { cleanup(false); }
  }, { once: true });
  video.addEventListener('error', () => cleanup(false), { once: true });
  video.src = source;
  video.load();
});

const processTaskPreviewQueue = () => {
  if (taskPreviewActive || !taskPreviewQueue.length) return;
  taskPreviewActive = true;
  const card = taskPreviewQueue.shift();
  captureTaskPreview(card).finally(() => {
    taskPreviewActive = false;
    window.setTimeout(processTaskPreviewQueue, 120);
  });
};

const queueTaskPreview = (card) => {
  if (card.dataset.previewQueued) return;
  card.dataset.previewQueued = 'true';
  taskPreviewQueue.push(card);
  processTaskPreviewQueue();
};

if ('IntersectionObserver' in window) {
  const previewObserver = new IntersectionObserver((entries, observer) => {
    entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
      queueTaskPreview(entry.target);
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '520px 0px' });
  taskPreviewCards.forEach((card) => previewObserver.observe(card));
} else {
  taskPreviewCards.forEach(queueTaskPreview);
}

const visualCopy = {
  observe: 'Start with the visible scene and a nominal action path. The hidden physical quantities are still at their baseline values.',
  change: 'A hidden physical parameter changes during contact — for example friction, mass, compliance, or contact geometry. The camera and state signals reveal its effects.',
  adapt: 'The policy revises its next action using the new evidence, then continues toward the same task goal without a privileged reset.'
};
const visualState = {
  observe: { index: '01', title: 'Baseline observation', subtitle: 'Initial scene · nominal path', badge: 'nominal' },
  change: { index: '02', title: 'Hidden parameter changes', subtitle: 'Concept example: contact friction μ 0.42 → 0.24', badge: 'hidden Δ' },
  adapt: { index: '03', title: 'Action is replanned', subtitle: 'Action path: nominal → revised', badge: 'adaptive' }
};
const adaptationVisual = document.querySelector('.background-visual');
const visualExplainer = document.querySelector('[data-visual-copy]');
const visualIndex = document.querySelector('[data-visual-index]');
const visualTitle = document.querySelector('[data-visual-title]');
const visualSubtitle = document.querySelector('[data-visual-subtitle]');
const visualBadge = document.querySelector('[data-visual-badge]');
document.querySelectorAll('[data-visual-step]').forEach((tab) => {
  if (!tab.classList.contains('visual-tab')) return;
  tab.addEventListener('click', () => {
    const step = tab.dataset.visualStep || 'observe';
    adaptationVisual?.setAttribute('data-visual-step', step);
    document.querySelectorAll('.visual-tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    if (visualExplainer) visualExplainer.textContent = visualCopy[step] || visualCopy.observe;
    const state = visualState[step] || visualState.observe;
    if (visualIndex) visualIndex.textContent = state.index;
    if (visualTitle) visualTitle.textContent = state.title;
    if (visualSubtitle) visualSubtitle.textContent = state.subtitle;
    if (visualBadge) visualBadge.textContent = state.badge;
    if (adaptationVisual) adaptationVisual.dataset.visualStep = step;
    adaptationVisual?.setAttribute('aria-label', `${state.title}. ${state.subtitle}`);
  });
});

document.querySelectorAll('.details-reveal').forEach((details) => {
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    document.querySelectorAll('.details-reveal').forEach((other) => {
      if (other !== details) other.removeAttribute('open');
    });
  });
});

const citationCopyButton = document.querySelector('[data-copy-citation]');
citationCopyButton?.addEventListener('click', async () => {
  const citation = document.querySelector('[data-citation-text]')?.textContent?.trim();
  if (!citation) return;
  try {
    await navigator.clipboard.writeText(citation);
    citationCopyButton.innerHTML = 'Copied <span>✓</span>';
    window.setTimeout(() => { citationCopyButton.innerHTML = 'Copy citation <span>↗</span>'; }, 1800);
  } catch {
    citationCopyButton.innerHTML = 'Copy unavailable <span>!</span>';
  }
});

const taskModal = document.querySelector('#task-modal');
const taskModalVideo = document.querySelector('#task-modal-video');
const taskVideoMessage = document.querySelector('#task-video-message');
const taskModalKicker = document.querySelector('#task-modal-kicker');
const taskModalTitle = document.querySelector('#task-modal-title');
const taskModalDescription = document.querySelector('#task-modal-description');
const taskModalTag = document.querySelector('#task-modal-tag');
let lastTaskTrigger;
const taskModalFocusableSelector = 'button, [href], input, select, textarea, video[controls], [tabindex]:not([tabindex="-1"])';

if (taskModal) {
  taskModal.hidden = true;
  taskModal.setAttribute('aria-hidden', 'true');
}

const closeTaskModal = () => {
  if (!taskModal) return;
  taskModal.hidden = true;
  taskModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('task-modal-open');
  if (taskModalVideo) {
    taskModalVideo.pause();
    taskModalVideo.removeAttribute('src');
    taskModalVideo.load();
  }
  if (lastTaskTrigger?.isConnected) lastTaskTrigger.focus();
};

const openTaskModal = (trigger) => {
  const card = trigger.closest('.task-spec');
  if (!card || !taskModal) return;
  lastTaskTrigger = trigger;
  const id = card.dataset.taskId || '01';
  const title = card.querySelector('h3')?.textContent?.trim() || 'Task detail';
  const tag = trigger.textContent.replace('↗', '').trim();
  if (taskModalKicker) taskModalKicker.textContent = `TASK ${id} · DEMO`;
  if (taskModalTitle) taskModalTitle.textContent = title;
  if (taskModalDescription) taskModalDescription.textContent = card.dataset.description || '';
  if (taskModalTag) taskModalTag.textContent = tag;
  taskModal.hidden = false;
  taskModal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('task-modal-open');
  if (taskVideoMessage) taskVideoMessage.hidden = true;
  if (taskModalVideo) {
    taskModalVideo.addEventListener('error', () => {
      if (taskVideoMessage) taskVideoMessage.hidden = false;
    }, { once: true });
    taskModalVideo.src = card.dataset.video || '';
    taskModalVideo.load();
    if (!prefersReducedMotion) window.setTimeout(() => taskModalVideo.play().catch(() => {}), 0);
  }
  taskModal.querySelector('.task-modal-close')?.focus();
};

document.querySelectorAll('[data-open-task]').forEach((trigger) => {
  trigger.addEventListener('click', () => openTaskModal(trigger));
});
document.querySelectorAll('[data-close-task]').forEach((control) => {
  control.addEventListener('click', closeTaskModal);
});
document.addEventListener('keydown', (event) => {
  if (!taskModal || taskModal.hidden) return;
  if (event.key === 'Escape') {
    closeTaskModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = [...taskModal.querySelectorAll(taskModalFocusableSelector)]
    .filter((element) => !element.disabled && element.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
