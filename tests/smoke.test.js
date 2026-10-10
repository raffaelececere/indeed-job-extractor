'use strict';

// Lightweight DOM simulation for the userscript's sequential extraction loop.
// Does not claim compatibility with the live Indeed website.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'indeed-job-extractor.user.js'), 'utf8');

function harness({ initial = 2, limit = 10, batches = [2, 2], preSaved = [], activateViaWrapper = false } = {}) {
  const storage = new Map();
  if (preSaved.length) storage.set('IJE_V01_jobs', JSON.stringify(preSaved));
  storage.set('IJE_V01_limit', JSON.stringify(limit));
  const all = Array.from({ length: initial + batches.reduce((a, b) => a + b, 0) }, (_, i) => ({
    id: `abcd${String(i + 1).padStart(8, '0')}`,
    title: `Job Title ${i + 1}`,
    description: `Job description ${i + 1} and relevant technical experience. `.repeat(3)
  }));
  let visible = initial;
  let batchIndex = 0;
  let selected = null;
  let scrollCalls = 0;
  let nativeNavigations = 0;
  let wrapperActivations = 0;
  const controls = new Map();
  const button = id => {
    if (!controls.has(id)) {
      const listeners = {};
      controls.set(id, {
        id, value: id === 'limit' ? '25' : '', style: {}, hidden: false,
        disabled: false, textContent: '', innerText: '',
        addEventListener: (type, cb) => { listeners[type] = cb; },
        click: () => listeners.click?.(),
        setPointerCapture: () => {},
        closest: () => null
      });
    }
    return controls.get(id);
  };
  const shadow = {
    innerHTML: '',
    getElementById: button,
    querySelector: () => button('panel')
  };
  const anchors = all.map((job, i) => {
    const card = {
      tagName: 'DIV',
      click: () => { selected = job; wrapperActivations++; },
      innerText: `${job.title} Example Corp Rome`,
      querySelector: selector => selector.includes('company') || selector.includes('companyName')
        ? { innerText: 'Example Corp' }
        : { innerText: 'Rome' }
    };
    const clickHandlers = new Set();
    return {
      innerText: job.title,
      textContent: job.title,
      parentElement: null,
      getAttribute: key => key === 'data-jk' ? job.id : null,
      closest: () => card,
      scrollIntoView: () => {},
      addEventListener: (type, fn) => { if (type === 'click') clickHandlers.add(fn); },
      removeEventListener: (type, fn) => { if (type === 'click') clickHandlers.delete(fn); },
      click: () => {
        const event = {
          cancelable: true, defaultPrevented: false,
          preventDefault() { this.defaultPrevented = true; }
        };
        for (const handler of clickHandlers) handler(event);
        if (!event.defaultPrevented) nativeNavigations++;
        if (!activateViaWrapper) selected = job;
      },
      href: `https://it.indeed.com/viewjob?jk=${job.id}`,
      index: i
    };
  });
  const pane = { querySelector: () => content };
  const content = {
    get innerText() { return selected ? `${selected.title} Example Corp Rome ${selected.description}` : ''; },
    querySelector: () => description
  };
  const description = {
    get innerText() { return selected?.description || ''; }
  };
  const scroller = {
    appendChild: () => {},
    scrollHeight: 6000,
    clientHeight: 1000
  };
  const document = {
    documentElement: scroller,
    scrollingElement: scroller,
    body: { appendChild: () => {} },
    getElementById: () => null,
    createElement: tag => tag === 'div'
      ? { id: '', style: {}, attachShadow: () => shadow }
      : { style: {}, click: () => {}, remove: () => {} },
    querySelectorAll: () => anchors.slice(0, visible),
    querySelector: selector => selector.includes('ViewjobPaneWrapper') ? pane : null
  };
  const location = {
    hostname: 'it.indeed.com', pathname: '/',
    get href() { return `https://it.indeed.com/${selected ? `?vjk=${selected.id}` : ''}`; }
  };
  const window = {
    get top() { return window; }, get self() { return window; },
    addEventListener: () => {},
    scrollTo: () => {
      scrollCalls++;
      if (batchIndex < batches.length) visible += batches[batchIndex++];
    }
  };
  let time = Date.now();
  class TestDate extends Date { static now() { time += 200; return time; } }
  const context = {
    window, document, location, Date: TestDate,
    innerWidth: 1400, innerHeight: 900,
    Event: class Event {}, URL, Blob,
    GM_getValue: (key, fallback) => storage.get(key) ?? fallback,
    GM_setValue: (key, value) => storage.set(key, value),
    getComputedStyle: () => ({ overflowY: 'visible' }),
    setTimeout: (cb, _ms) => setTimeout(cb, 1),
    clearTimeout,
    console: { debug() {}, warn() {}, error() {} },
    confirm: () => true
  };
  vm.runInNewContext(source, context, { filename: 'indeed-job-extractor.user.js' });
  const finished = async () => {
    for (let i = 0; i < 2000; i++) {
      const logs = JSON.parse(storage.get('IJE_V01_logs') || '[]');
      if (logs.some(entry => entry.event === 'run_finished')) return;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    throw new Error('Extraction did not finish within test timeout');
  };
  return {
    button, storage, finished,
    stats: () => ({
      jobs: JSON.parse(storage.get('IJE_V01_jobs') || '[]'),
      logs: JSON.parse(storage.get('IJE_V01_logs') || '[]'),
      scrollCalls,
      nativeNavigations,
      wrapperActivations
    })
  };
}

test('stops at the selected listing limit while discovering new cards', async () => {
  const h = harness({ initial: 2, limit: 10, batches: [2, 2, 5] });
  h.button('start').click();
  await h.finished();
  const { jobs, logs, scrollCalls } = h.stats();
  assert.equal(jobs.length, 10);
  assert.equal(new Set(jobs.map(job => job.id)).size, 10);
  assert.ok(jobs.every(job => job.description.includes(job.title.replace('Job Title', 'Job description'))));
  assert.equal(logs.find(entry => entry.event === 'run_finished')?.reason, 'job_limit_reached');
  assert.ok(scrollCalls >= 1);
});

test('stops when scrolling yields no new job IDs', async () => {
  const h = harness({ initial: 2, limit: 25, batches: [1] });
  h.button('start').click();
  await h.finished();
  const { jobs, logs, scrollCalls } = h.stats();
  assert.equal(jobs.length, 3);
  assert.equal(logs.find(entry => entry.event === 'run_finished')?.reason, 'no_more_jobs');
  assert.equal(scrollCalls, 6); // one discovery + five exhausted attempts
});

test('keeps previously saved results and skips their IDs', async () => {
  const preSaved = [{ id: 'abcd00000001', title: 'Old saved listing', description: 'saved' }];
  const h = harness({ initial: 2, limit: 1, batches: [], preSaved });
  h.button('start').click();
  await h.finished();
  const { jobs, logs } = h.stats();
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].title, 'Old saved listing');
  assert.equal(logs.find(entry => entry.event === 'run_finished')?.skippedExisting, 1);
});

test('STOP preserves the partial results already captured', async () => {
  const h = harness({ initial: 12, limit: 10, batches: [] });
  h.button('start').click();
  let saved = false;
  for (let i = 0; i < 1000; i++) {
    if (h.stats().jobs.length >= 1) { saved = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.ok(saved, 'at least one listing should be captured before requesting STOP');
  h.button('stop').click();
  await h.finished();
  const { jobs, logs } = h.stats();
  assert.ok(jobs.length >= 1 && jobs.length < 10);
  assert.equal(logs.find(entry => entry.event === 'run_finished')?.reason, 'user_stop');
});


test('never triggers native anchor navigation during automatic extraction', async () => {
  const h = harness({ initial: 10, limit: 10, batches: [] });
  h.button('start').click();
  await h.finished();
  const { jobs, nativeNavigations, logs } = h.stats();
  assert.equal(jobs.length, 10);
  assert.equal(nativeNavigations, 0, 'link default action must be cancelled');
  assert.equal(logs.find(entry => entry.event === 'run_finished')?.reason, 'job_limit_reached');
});

test('uses non-link wrapper when safe anchor action does not switch the pane', async () => {
  const h = harness({ initial: 10, limit: 10, batches: [], activateViaWrapper: true });
  h.button('start').click();
  await h.finished();
  const { jobs, logs, nativeNavigations, wrapperActivations } = h.stats();
  assert.equal(jobs.length, 10);
  assert.equal(nativeNavigations, 0);
  assert.equal(wrapperActivations, 10);
  assert.equal(logs.filter(entry => entry.event === 'safe_anchor_did_not_update_pane').length, 10);
  assert.equal(logs.find(entry => entry.event === 'run_finished')?.reason, 'job_limit_reached');
});
