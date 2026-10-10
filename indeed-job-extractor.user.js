// ==UserScript==
// @name         Indeed Job Extractor
// @namespace    https://github.com/raffaelececere
// @version      0.4.0
// @description  Collect Indeed job listings with bounded infinite-scroll discovery, verified descriptions, local storage and JSON/TXT exports.
// @author       Raffaele Marco Cecere
// @homepageURL  https://github.com/raffaelececere/indeed-job-extractor
// @supportURL   https://github.com/raffaelececere/indeed-job-extractor/issues
// @updateURL    https://raw.githubusercontent.com/raffaelececere/indeed-job-extractor/main/indeed-job-extractor.user.js
// @downloadURL  https://raw.githubusercontent.com/raffaelececere/indeed-job-extractor/main/indeed-job-extractor.user.js
// @match        https://*.indeed.com/*
// @match        https://indeed.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  if (window.top !== window.self || document.getElementById('ije-root')) return;

  const VERSION = '0.4.0';
  // Preserve v0.1 saved results and diagnostics after an upgrade.
  const PREFIX = 'IJE_V01_';
  const LIMITS = [10, 25, 50, 100, 250, 500];
  const CONFIG = Object.freeze({
    maxLogs: 1200,
    paneTimeoutMs: 10000,
    fallbackActivationMs: 4000,
    panePollMs: 120,
    paneStableMs: 450,
    scrollPauseMs: 1400,
    maxIdleScrolls: 5,
    maxPages: 60,
    pageTransitionMs: 7500,
    pagePollMs: 150,
    maxConsecutiveErrors: 3,
    maxRunMs: 45 * 60 * 1000
  });
  const SELECTORS = Object.freeze({
    anchors: ['a.jcs-JobTitle[data-jk]', 'a[data-jk][href]'],
    cards: ['.job_seen_beacon', '[data-testid="slider_item"]', 'li'],
    panes: ['#jobsearch-ViewjobPaneWrapper', '.jobsearch-RightPane', '[data-testid="jobsearch-ViewjobPaneWrapper"]'],
    contents: ['[data-testid="viewjob-main-content"]', '[data-testid="jobsearch-JobComponent"]'],
    descriptions: ['.simple-job-description-html', '#jobDescriptionText']
  });

  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const idValid = id => /^[a-z0-9]{8,40}$/i.test(id || '');
  const firstWithin = (root, selectors) => {
    for (const selector of selectors) {
      const element = root?.querySelector(selector);
      if (element) return element;
    }
    return null;
  };
  const safeParse = (str, fallback) => {
    try { return JSON.parse(str); } catch { return fallback; }
  };
  const read = (key, fallback) => {
    try { return safeParse(GM_getValue(PREFIX + key, JSON.stringify(fallback)), fallback); }
    catch { return fallback; }
  };
  const write = (key, value) => {
    try { GM_setValue(PREFIX + key, JSON.stringify(value)); return true; }
    catch { return false; }
  };
  const safeHost = () => /(^|\.)indeed\.com$/i.test(location.hostname) ? location.hostname : 'www.indeed.com';
  const canonicalUrl = id => `https://${safeHost()}/viewjob?jk=${encodeURIComponent(id)}`;

  const jobs = new Map();
  const storedJobs = read('jobs', []);
  for (const job of Array.isArray(storedJobs) ? storedJobs : []) {
    if (idValid(job?.id)) jobs.set(job.id, job);
  }
  let logs = read('logs', []);
  if (!Array.isArray(logs)) logs = [];
  let running = false;
  let stopRequested = false;
  let minimized = false;
  let status = 'Ready';
  let examined = 0;
  let savedNew = 0;
  let discovered = 0;
  let skippedExisting = 0;
  let errors = 0;
  let aliases = 0;
  let pagesProcessed = 1;
  let target = 25;
  let idleScrolls = 0;
  let lastRun = read('lastRun', null);
  const interruptedRun = read('activeRun', null);
  let resumeAfterNavigation = false;

  function log(level, event, fields = {}) {
    const entry = { at: new Date().toISOString(), level, event, ...fields };
    logs.push(entry);
    if (logs.length > CONFIG.maxLogs) logs = logs.slice(-CONFIG.maxLogs);
    write('logs', logs);
    const fn = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'debug';
    console[fn]('[Indeed Job Extractor]', event, fields);
  }

  function cardsNow() {
    const result = new Map();
    for (const anchor of document.querySelectorAll(SELECTORS.anchors.join(','))) {
      const id = anchor.getAttribute('data-jk') || anchor.closest('[data-jk]')?.getAttribute('data-jk');
      if (!idValid(id) || result.has(id)) continue;
      const card = anchor.closest(SELECTORS.cards.join(','));
      if (!card) continue;
      const title = clean(anchor.innerText || anchor.textContent);
      if (!title) continue;
      const cardText = clean(card.innerText || card.textContent);
      result.set(id, {
        id,
        title,
        company: clean(firstWithin(card, ['.companyName', '[data-testid="company-name"]'])?.innerText) || null,
        location: clean(firstWithin(card, ['.companyLocation', '[data-testid="text-location"]', '[data-testid="job-location"]'])?.innerText) || null,
        cardText,
        sponsored: /\b(annuncio|sponsored|promoted)\b/i.test(cardText)
      });
    }
    return result;
  }

  function currentId() {
    try { return new URL(location.href).searchParams.get('vjk'); }
    catch { return null; }
  }
  function paneSnapshot() {
    const pane = firstWithin(document, SELECTORS.panes);
    const content = firstWithin(pane, SELECTORS.contents);
    const descriptionEl = firstWithin(content || pane, SELECTORS.descriptions);
    if (!pane || !content || !descriptionEl) return null;
    const detail = clean(content.innerText || content.textContent);
    const description = clean(descriptionEl.innerText || descriptionEl.textContent);
    return { detail, description, descriptionLength: description.length };
  }
  function titleMatches(detail, title) {
    const normalizedTitle = clean(title).toLocaleLowerCase();
    const beginning = clean(detail).slice(0, Math.max(title.length + 40, 180)).toLocaleLowerCase();
    return !!normalizedTitle && beginning.startsWith(normalizedTitle);
  }
  function findAnchor(id) {
    for (const anchor of document.querySelectorAll(SELECTORS.anchors.join(','))) {
      if (anchor.getAttribute('data-jk') === id && anchor.closest(SELECTORS.cards.join(','))) return anchor;
    }
    return null;
  }
  async function waitForPane(card, previous, timeoutMs = CONFIG.paneTimeoutMs, initialPath = location.pathname) {
    const deadline = Date.now() + timeoutMs;
    let signature = null;
    let stableSince = 0;
    let reason = 'timeout';
    while (Date.now() < deadline) {
      if (stopRequested) return { ok: false, reason: 'stopped' };
      if (location.pathname !== initialPath) return { ok: false, reason: 'route_changed' };
      const jobId = currentId();
      const snap = paneSnapshot();
      if (jobId !== card.id) reason = `URL ID mismatch (${jobId || 'none'})`;
      else if (!snap || snap.descriptionLength < 60) reason = 'description missing or too short';
      else if (!titleMatches(snap.detail, card.title)) reason = 'pane title differs from card';
      else if (previous && previous.id !== card.id && previous.detail === snap.detail) reason = 'pane content unchanged';
      else {
        const nextSignature = `${jobId}\n${snap.detail}\n${snap.description}`;
        if (signature !== nextSignature) {
          signature = nextSignature;
          stableSince = Date.now();
        }
        if (Date.now() - stableSince >= CONFIG.paneStableMs) return { ok: true, snap };
      }
      await sleep(CONFIG.panePollMs);
    }
    return { ok: false, reason };
  }
  // Never invoke an unguarded native link click: on Indeed it can navigate
  // the top-level tab to /viewjob rather than switch the existing right pane.
  // We prevent the browser's link default at capture time while retaining the
  // site's ordinary click handlers. If the UI does not update, we stop/skip.
  function activateAnchorWithoutNavigation(anchor, cardId) {
    const cancelNativeNavigation = event => {
      if (event.cancelable) event.preventDefault();
    };
    anchor.addEventListener('click', cancelNativeNavigation, { capture: true });
    try {
      anchor.click();
      log('info', 'safe_anchor_activated', { id: cardId });
    } finally {
      anchor.removeEventListener('click', cancelNativeNavigation, true);
    }
  }

  // A non-link result-card wrapper is a conservative fallback on layouts where
  // React intentionally ignores a default-prevented anchor click.
  function activateCardWrapper(anchor, cardId) {
    const cardRoot = anchor.closest('.job_seen_beacon, [data-testid="slider_item"]');
    if (!cardRoot || cardRoot.tagName === 'A') return false;
    cardRoot.click();
    log('info', 'safe_card_activated', { id: cardId });
    return true;
  }

  function saveJobs() {
    const ok = write('jobs', [...jobs.values()]);
    if (!ok) log('error', 'storage_failure', { saved: jobs.size });
    return ok;
  }

  // The scroll container must belong to the job list, never to the details pane.
  // On layouts using document scrolling, fall back to the document scroller.
  function findListScroller() {
    const anchors = [...document.querySelectorAll(SELECTORS.anchors.join(','))];
    const last = anchors.at(-1);
    if (!last) return document.scrollingElement || document.documentElement;
    let element = last.parentElement;
    while (element && element !== document.body && element !== document.documentElement) {
      const style = getComputedStyle(element);
      if (/auto|scroll/i.test(style.overflowY) && element.scrollHeight > element.clientHeight + 24) {
        return element;
      }
      element = element.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }
  function scrollForMore() {
    const anchors = [...document.querySelectorAll(SELECTORS.anchors.join(','))];
    const last = anchors.at(-1);
    const scroller = findListScroller();
    if (!scroller) return 'no_scroller';
    if (last) last.scrollIntoView({ block: 'end', inline: 'nearest', behavior: 'instant' });
    if (scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body) {
      window.scrollTo({ top: (document.scrollingElement || document.documentElement).scrollHeight, behavior: 'instant' });
      return 'document';
    }
    scroller.scrollTop = scroller.scrollHeight;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    return 'nested_container';
  }


  // Search-result pages use pagination; homepage feeds may use infinite scroll.
  // Use Indeed's real UI controls, never fabricated pagination links.
  function searchKey(raw = location.href) {
    try {
      const u = new URL(raw, location.href);
      for (const name of ['start', 'page', 'p', 'vjk', 'jk', 'from']) u.searchParams.delete(name);
      const values = [...u.searchParams.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
      return `${u.origin}${u.pathname}?${new URLSearchParams(values)}`;
    } catch { return location.pathname; }
  }
  function pageKey(raw = location.href) {
    try {
      const u = new URL(raw, location.href);
      u.searchParams.delete('vjk'); u.searchParams.delete('jk');
      return `${u.origin}${u.pathname}?${[...u.searchParams.entries()].sort().map(x => x.join('=')).join('&')}`;
    } catch { return String(raw); }
  }
  function eligiblePageElement(el) {
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    if (el.closest('#ije-root')) return false;
    if (el.tagName === 'A' && el.href) {
      try {
        const dest = new URL(el.href, location.href);
        if (dest.origin !== location.origin || !/^\/jobs\/?$/.test(dest.pathname)) return false;
      } catch { return false; }
    }
    return true;
  }
  function paginationRoot() {
    const candidates = [...document.querySelectorAll(
      'nav[aria-label*="pagin" i], nav[aria-label*="page" i], [data-testid*="pagination" i], [class*="pagination" i]'
    )].filter(el => !el.closest('#ije-root'));
    const direct = candidates.find(el => el.querySelector('a,button,[role="button"]'));
    if (direct) return direct;
    return [...document.querySelectorAll('nav')].find(nav =>
      [...nav.querySelectorAll('a,button,[role="button"]')]
        .filter(el => /^\d+$/.test(clean(el.innerText || el.textContent))).length >= 2
    ) || null;
  }
  function nextPageControl() {
    if (!/^\/jobs\/?$/.test(location.pathname)) return null;
    const explicit = document.querySelector('a[data-testid="pagination-page-next"], button[data-testid="pagination-page-next"]');
    if (explicit && eligiblePageElement(explicit)) return explicit;
    const root = paginationRoot();
    if (!root) return null;
    const controls = [...root.querySelectorAll('a,button,[role="button"]')].filter(eligiblePageElement);
    const next = controls.find(el => {
      const label = [el.getAttribute('aria-label'), el.getAttribute('data-testid'), el.title, el.getAttribute('rel')].filter(Boolean).join(' ');
      return /(^|[\s_-])(next|successiv|seguent|weiter|suivant|siguiente|pr[oó]xim)([\s_-]|$)/i.test(label)
        || el.getAttribute('rel') === 'next';
    });
    if (next) return next;
    const trailingArrow = controls.at(-1);
    if (trailingArrow && /^(›|»|→|❯|>)$/.test(clean(trailingArrow.innerText || trailingArrow.textContent))) return trailingArrow;
    const current = controls.find(el => el.getAttribute('aria-current') === 'page'
      || el.getAttribute('data-testid') === 'pagination-page-current')
      || controls.find(el => el.getAttribute('aria-selected') === 'true');
    const pageNumber = current ? Number(clean(current.innerText || current.textContent)) : NaN;
    if (Number.isInteger(pageNumber)) {
      return controls.find(el => clean(el.innerText || el.textContent) === String(pageNumber + 1)) || null;
    }
    return null;
  }
  function canonicalCardFingerprint(card) {
    return [card.title, card.company, card.location, card.cardText]
      .map(value => clean(value).toLocaleLowerCase()).join('\n');
  }
  function matchingSavedDuplicate(card, currentPaneId) {
    const original = jobs.get(currentPaneId);
    if (!original || currentPaneId === card.id) return null;
    const sameTitle = clean(original.title).toLocaleLowerCase() === clean(card.title).toLocaleLowerCase();
    const sameCompany = !!clean(original.company) && clean(original.company).toLocaleLowerCase() === clean(card.company).toLocaleLowerCase();
    const sameLocation = !!clean(original.location) && clean(original.location).toLocaleLowerCase() === clean(card.location).toLocaleLowerCase();
    const sameCard = canonicalCardFingerprint(original) === canonicalCardFingerprint(card);
    // Even if an unresponsive card looks duplicated, never save it under an unverified ID.
    return sameTitle && (sameCard || (sameCompany && sameLocation)) ? original.id : null;
  }

  const root = document.createElement('div');
  root.id = 'ije-root';
  root.style.cssText = 'position:fixed;z-index:2147483647;top:88px;right:20px;';
  document.documentElement.appendChild(root);
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      *{box-sizing:border-box}:host{all:initial}
      .panel{width:318px;background:#151c2b;color:#edf2ff;border:1px solid #36445b;border-radius:12px;box-shadow:0 12px 36px #0006;font:13px/1.42 Arial,Helvetica,sans-serif;overflow:hidden}
      .head{padding:12px 14px;background:#202c40;display:flex;align-items:center;justify-content:space-between;cursor:move;user-select:none}
      .brand{font-weight:700;font-size:14px}.version{font-size:11px;color:#b9c5d8;margin-left:5px}
      .body{padding:13px}.status{color:#bcd2ee;margin-bottom:9px;overflow-wrap:anywhere;min-height:19px}
      .choice{display:flex;align-items:center;gap:10px;margin-bottom:10px;color:#dce5f5;font-size:12px}
      select{margin-left:auto;background:#253750;border:1px solid #566b8a;color:white;border-radius:6px;padding:5px 8px;font-weight:700;min-width:105px}
      select:disabled{opacity:.55}
      .progress{height:7px;background:#39485d;border-radius:6px;overflow:hidden;margin:10px 0}
      .fill{height:100%;width:0;background:#65adff;transition:width .2s}
      .stats{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;color:#d2dbea}
      .stats strong{color:#fff}.buttons{display:grid;grid-template-columns:1fr 1fr;gap:7px}
      button{border:1px solid #53647b;border-radius:7px;background:#2b3950;color:white;padding:8px 7px;cursor:pointer;font-weight:600;font-size:12px}
      button:hover:not(:disabled){background:#3c4f6d}button:disabled{opacity:.4;cursor:default}
      .primary{background:#1965bd;border-color:#3680d0}.primary:hover:not(:disabled){background:#277bd7}
      .danger{background:#512c36;border-color:#75505a}.small{padding:2px 7px;font-size:17px;line-height:1.2}
      .hint{font-size:11px;line-height:1.45;color:#abbad0;margin-top:10px}
      .mini{position:fixed;right:18px;top:88px;border-radius:20px;padding:9px 13px;background:#202c40}
      [hidden]{display:none!important}
    </style>
    <section class="panel" aria-label="Indeed Job Extractor">
      <div class="head" id="drag"><span class="brand">Indeed Job Extractor <span class="version">v${VERSION}</span></span><button class="small" id="minimize" title="Minimize panel" aria-label="Minimize">−</button></div>
      <div class="body">
        <div class="status" id="status">Ready</div>
        <label class="choice" for="limit">New jobs to save <select id="limit">${LIMITS.map(n => `<option value="${n}">${n} jobs</option>`).join('')}</select></label>
        <div class="progress"><div class="fill" id="fill"></div></div>
        <div class="stats">
          <span>Visible cards: <strong id="cards">0</strong></span><span>Saved this run: <strong id="progress">0/25</strong></span>
          <span>Examined: <strong id="examined">0</strong></span><span>Discovered: <strong id="discovered">0</strong></span>
          <span>Saved total: <strong id="saved">0</strong></span>
          <span>Existing skipped: <strong id="skipped">0</strong></span><span>Errors: <strong id="errors">0</strong></span>
          <span>Duplicate aliases: <strong id="aliases">0</strong></span><span>Pages: <strong id="pages">1</strong></span>
        </div>
        <div class="buttons">
          <button class="primary" id="start">START EXTRACTION</button><button id="stop" disabled>STOP</button>
          <button id="json">EXPORT JSON</button><button id="txt">EXPORT TXT</button>
          <button id="debug">DEBUG LOG</button><button class="danger" id="clear">CLEAR SAVED</button>
        </div>
        <div class="hint">Numbered search pages + bounded homepage scrolling · Sequential extraction · Per-run target counts new jobs successfully saved. Saved jobs remain available locally.</div>
      </div>
    </section>
    <button class="mini" id="reopen" hidden>Indeed Extractor</button>`;
  const ui = id => shadow.getElementById(id);
  const savedLimit = Number(read('limit', 25));
  ui('limit').value = String(LIMITS.includes(savedLimit) ? savedLimit : 25);
  target = Number(ui('limit').value);

  function updateUI() {
    ui('status').textContent = status;
    ui('cards').textContent = String(cardsNow().size);
    ui('progress').textContent = `${savedNew}/${target}`;
    ui('examined').textContent = String(examined);
    ui('discovered').textContent = String(discovered);
    ui('saved').textContent = String(jobs.size);
    ui('skipped').textContent = String(skippedExisting);
    ui('errors').textContent = String(errors);
    ui('aliases').textContent = String(aliases);
    ui('pages').textContent = String(pagesProcessed);
    ui('fill').style.width = `${Math.min(100, (savedNew / target) * 100)}%`;
    ui('start').disabled = running;
    ui('stop').disabled = !running;
    ui('limit').disabled = running;
    ui('clear').disabled = running;
    ui('reopen').hidden = !minimized;
    shadow.querySelector('.panel').hidden = minimized;
  }

  async function extract(resume = false) {
    if (running) return;
    if (!cardsNow().size) {
      status = 'No job cards found. Open an Indeed results list.';
      updateUI();
      return;
    }
    const restored = resume ? read('activeRun', null) : null;
    if (resume && (!restored?.navigationPending || restored.searchKey !== searchKey()
      || restored.fromPageKey === pageKey())) return;
    running = true;
    stopRequested = false;
    examined = restored?.examined || 0;
    savedNew = restored?.savedNew || 0;
    skippedExisting = restored?.skippedExisting || 0;
    errors = restored?.errors || 0;
    aliases = restored?.aliases || 0;
    pagesProcessed = restored?.pagesProcessed || 1;
    idleScrolls = 0;
    target = restored?.target || Number(ui('limit').value);
    ui('limit').value = String(target);
    write('limit', target);
    const started = restored?.startedAtMs || Date.now();
    const known = new Map();
    const seen = new Set(restored?.seen || []);
    const visited = new Set(restored?.visited || []);
    const seenPages = new Set(restored?.seenPages || []);
    seenPages.add(pageKey());
    if (restored) pagesProcessed++;
    let previous = null;
    let consecutiveErrors = 0;
    let endReason = 'completed';
    const initialPath = location.pathname;
    function saveCheckpoint(navigationPending = false) {
      write('activeRun', {
        startedAtMs: started, searchKey: searchKey(), target, examined, savedNew,
        skippedExisting, errors, aliases, pagesProcessed,
        seen: [...seen], visited: [...visited], seenPages: [...seenPages],
        navigationPending, fromPageKey: pageKey()
      });
    }
    saveCheckpoint();
    log('info', restored ? 'run_resumed' : 'run_started', {
      path: initialPath, target, alreadySaved: jobs.size, pagesProcessed
    });

    function discover() {
      let added = 0;
      for (const [id, card] of cardsNow()) {
        if (!seen.has(id)) {
          added++;
          seen.add(id);
          if (jobs.has(id)) skippedExisting++;
        }
        known.set(id, card);
      }
      discovered = seen.size;
      return added;
    }


    async function moveToNextPage() {
      if (pagesProcessed >= CONFIG.maxPages) return 'max_pages';
      const control = nextPageControl();
      if (!control) return 'no_next_page';
      const targetHref = control.href || null;
      if (targetHref && seenPages.has(pageKey(targetHref))) return 'pagination_loop';
      if (targetHref && searchKey(targetHref) !== searchKey()) return 'pagination_search_changed';
      const beforeIds = new Set(cardsNow().keys());
      const fromKey = pageKey();
      saveCheckpoint(true);
      log('info', 'pagination_next', {
        page: pagesProcessed, from: fromKey,
        destination: targetHref ? pageKey(targetHref) : 'UI control'
      });
      status = `Opening next results page (${pagesProcessed + 1})…`;
      updateUI();
      control.click();
      const deadline = Date.now() + CONFIG.pageTransitionMs;
      while (!stopRequested && Date.now() < deadline) {
        if (location.pathname !== initialPath) return 'route_changed';
        const nowIds = [...cardsNow().keys()];
        const different = nowIds.some(id => !beforeIds.has(id));
        if (different) {
          pagesProcessed++;
          seenPages.add(pageKey());
          known.clear();
          idleScrolls = 0;
          saveCheckpoint(false);
          log('info', 'pagination_loaded', {
            page: pagesProcessed, newPageJobIds: nowIds.filter(id => !beforeIds.has(id)).length
          });
          return 'loaded';
        }
        await sleep(CONFIG.pagePollMs);
      }
      if (stopRequested) return 'stopped';
      if (targetHref && pageKey(targetHref) !== fromKey && pageKey() === fromKey) {
        log('warn', 'pagination_no_transition', { page: pagesProcessed });
      }
      saveCheckpoint(false);
      return 'no_transition';
    }

    try {
      discover();
      updateUI();
      while (!stopRequested && examined < target) {
        if (location.pathname !== initialPath) {
          endReason = 'route_changed';
          log('error', 'route_changed', { initialPath, newPath: location.pathname });
          break;
        }
        if (Date.now() - started > CONFIG.maxRunMs) {
          endReason = 'run_timeout';
          log('warn', 'run_timeout', { elapsedMs: Date.now() - started });
          break;
        }
        discover();
        const next = [...known.values()].find(card => !visited.has(card.id) && !jobs.has(card.id));
        if (!next) {
          if (idleScrolls >= CONFIG.maxIdleScrolls) {
            endReason = 'no_more_jobs';
            break;
          }
          status = `Finding more jobs… (${idleScrolls + 1}/${CONFIG.maxIdleScrolls})`;
          updateUI();
          const scrollMode = scrollForMore();
          await sleep(CONFIG.scrollPauseMs);
          const added = discover();
          log('info', 'scroll_discovery', { mode: scrollMode, added, uniqueDiscovered: discovered });
          idleScrolls = added ? 0 : idleScrolls + 1;
          updateUI();
          continue;
        }
        idleScrolls = 0;
        visited.add(next.id);
        examined++;
        const anchor = findAnchor(next.id);
        if (!anchor) {
          errors++;
          consecutiveErrors++;
          status = `Card disappeared: ${next.title}`;
          log('warn', 'card_disappeared', { id: next.id, title: next.title });
          updateUI();
        } else {
          status = `Reading ${examined}/${target}: ${next.title}`;
          updateUI();
          const prior = paneSnapshot();
          const priorId = currentId();
          try {
            const baseline = prior ? { ...prior, id: priorId } : previous;
            activateAnchorWithoutNavigation(anchor, next.id);
            let result = await waitForPane(next, baseline, CONFIG.fallbackActivationMs, initialPath);
            if (!result.ok && result.reason !== 'stopped' && result.reason !== 'route_changed' && !stopRequested) {
              log('warn', 'safe_anchor_did_not_update_pane', { id: next.id, reason: result.reason });
              if (activateCardWrapper(anchor, next.id)) {
                result = await waitForPane(next, baseline, CONFIG.paneTimeoutMs - CONFIG.fallbackActivationMs, initialPath);
              }
            }
            if (result.ok) {
              const snap = result.snap;
              jobs.set(next.id, {
                id: next.id,
                title: next.title,
                company: next.company,
                location: next.location,
                sponsored: next.sponsored,
                url: canonicalUrl(next.id),
                sourceDomain: safeHost(),
                sourcePath: location.pathname,
                extractedAt: new Date().toISOString(),
                description: snap.description,
                descriptionLength: snap.descriptionLength,
                detailText: snap.detail,
                cardText: next.cardText,
                validation: { urlJobIdMatches: true, titleMatches: true, stableForMs: CONFIG.paneStableMs }
              });
              saveJobs();
              previous = { ...snap, id: next.id };
              consecutiveErrors = 0;
              log('info', 'job_saved', { id: next.id, title: next.title, descriptionLength: snap.descriptionLength });
            } else if (result.reason === 'stopped') {
              stopRequested = true;
            } else if (result.reason === 'route_changed') {
              endReason = 'route_changed';
              log('error', 'route_changed', { id: next.id, from: initialPath, to: location.pathname });
              break;
            } else {
              errors++;
              consecutiveErrors++;
              log('warn', 'job_skipped', { id: next.id, title: next.title, reason: result.reason, currentVjk: currentId() });
            }
          } catch (error) {
            errors++;
            consecutiveErrors++;
            log('error', 'job_exception', { id: next.id, message: String(error?.message || error) });
          }
          updateUI();
        }
        if (consecutiveErrors >= CONFIG.maxConsecutiveErrors) {
          endReason = 'consecutive_errors';
          log('error', 'error_threshold_reached', { examined, errors });
          break;
        }
        if (!stopRequested) await sleep(240);
      }
      if (stopRequested) endReason = 'user_stop';
      else if (examined >= target) endReason = 'job_limit_reached';
    } finally {
      running = false;
      stopRequested = false;
      lastRun = {
        finishedAt: new Date().toISOString(),
        target, examined, discovered, skippedExisting,
        errors, idleScrolls, savedTotal: jobs.size, reason: endReason
      };
      status = endReason === 'job_limit_reached'
        ? `Limit reached: ${examined} examined, ${jobs.size} saved total.`
        : endReason === 'no_more_jobs'
          ? `No more jobs detected: ${examined} examined.`
          : endReason === 'user_stop'
            ? 'Stopped manually. Partial results saved.'
            : `Stopped (${endReason}). Export DEBUG LOG.`;
      write('lastRun', lastRun);
      write('activeRun', null);
      log('info', 'run_finished', lastRun);
      updateUI();
    }
  }

  function download(contents, name, mime) {
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const fileName = (kind, ext) => `indeed_${kind}_${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
  function exportJSON() {
    download(JSON.stringify({
      generator: 'Indeed Job Extractor', version: VERSION,
      exportedAt: new Date().toISOString(), jobCount: jobs.size,
      jobs: [...jobs.values()]
    }, null, 2), fileName('jobs', 'json'), 'application/json;charset=utf-8');
  }
  function exportTXT() {
    const lines = [`Indeed Job Extractor v${VERSION}`, `Exported: ${new Date().toISOString()}`, `Jobs: ${jobs.size}`, ''];
    for (const job of jobs.values()) {
      lines.push('='.repeat(76), `TITLE: ${job.title}`, `COMPANY: ${job.company || 'Not available'}`,
        `LOCATION: ${job.location || 'Not available'}`, `JOB ID: ${job.id}`, `URL: ${job.url}`,
        `SPONSORED: ${job.sponsored ? 'Yes' : 'No'}`, '', 'FULL DESCRIPTION:', job.description,
        '', 'VISIBLE JOB DETAILS:', job.detailText, '', 'ORIGINAL CARD:', job.cardText, '');
    }
    download(lines.join('\n'), fileName('jobs', 'txt'), 'text/plain;charset=utf-8');
  }
  function exportDebug() {
    download(JSON.stringify({
      generator: 'Indeed Job Extractor', version: VERSION,
      exportedAt: new Date().toISOString(), pagePath: location.pathname,
      visibleCards: cardsNow().size, savedTotal: jobs.size, lastRun, logs
    }, null, 2), fileName('debug', 'json'), 'application/json;charset=utf-8');
  }

  ui('limit').addEventListener('change', () => {
    target = Number(ui('limit').value);
    write('limit', target);
    updateUI();
  });
  ui('start').addEventListener('click', () => { void extract(); });
  ui('stop').addEventListener('click', () => {
    stopRequested = true;
    status = 'Stopping after current check…';
    updateUI();
  });
  ui('json').addEventListener('click', exportJSON);
  ui('txt').addEventListener('click', exportTXT);
  ui('debug').addEventListener('click', exportDebug);
  ui('clear').addEventListener('click', () => {
    if (!confirm(`Delete ${jobs.size} locally saved listings and debug history?`)) return;
    jobs.clear(); logs = [];
    saveJobs(); write('logs', []);
    examined = discovered = skippedExisting = errors = idleScrolls = 0;
    lastRun = null;
    write('lastRun', null);
    write('activeRun', null);
    status = 'Local saved data cleared.';
    updateUI();
  });
  ui('minimize').addEventListener('click', () => { minimized = true; updateUI(); });
  ui('reopen').addEventListener('click', () => { minimized = false; updateUI(); });

  let drag = null;
  ui('drag').addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    drag = {
      x: e.clientX, y: e.clientY,
      left: root.getBoundingClientRect().left,
      top: root.getBoundingClientRect().top
    };
    ui('drag').setPointerCapture(e.pointerId);
  });
  ui('drag').addEventListener('pointermove', e => {
    if (!drag) return;
    root.style.right = 'auto';
    root.style.left = `${Math.max(0, Math.min(innerWidth - 80, drag.left + e.clientX - drag.x))}px`;
    root.style.top = `${Math.max(0, Math.min(innerHeight - 60, drag.top + e.clientY - drag.y))}px`;
  });
  ui('drag').addEventListener('pointerup', () => { drag = null; });
  ui('drag').addEventListener('pointercancel', () => { drag = null; });

  if (interruptedRun) {
    log('warn', 'previous_run_interrupted', interruptedRun);
    write('activeRun', null);
    status = 'Previous run interrupted. Saved listings were kept.';
  }
  window.addEventListener('pagehide', () => {
    if (running) {
      log('error', 'unexpected_page_navigation', {
        path: location.pathname, examined, saved: jobs.size,
        target, lastKnownJobId: currentId()
      });
    }
  });
  log('info', 'initialized', { version: VERSION, path: location.pathname, saved: jobs.size });
  updateUI();
})();
