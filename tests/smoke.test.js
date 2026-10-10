'use strict';

// Lightweight DOM simulation for the userscript's sequential extraction loop.
// Does not claim compatibility with the live Indeed website.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'indeed-job-extractor.user.js'), 'utf8');

function harness({ initial = 2, limit = 10, batches = [2, 2], preSaved = [], activateViaWrapper = false, pages = null, aliasAt = -1, startPage = 0, initialStorage = null, paginationClickNoOp = false, paginationHrefMode = 'normal', preloadedFirstPane = false, aliasOfAt = null, alsoMatchAt = -1, differentCompanyAt = -1, ignorePreselectedClick = false } = {}) {
  const storage = new Map(initialStorage || []);
  if (preSaved.length) storage.set('IJE_V01_jobs', JSON.stringify(preSaved));
  storage.set('IJE_V01_limit', JSON.stringify(limit));
  const all = Array.from({ length: pages ? pages.reduce((a, b) => a + b, 0) : initial + batches.reduce((a, b) => a + b, 0) }, (_, i) => ({
    id: `abcd${String(i + 1).padStart(8, '0')}`,
    title: `Job Title ${i + 1}`,
    company: i === differentCompanyAt ? 'Different Corp' : 'Example Corp',
    description: `Job description ${i + 1} and relevant technical experience. `.repeat(3)
  }));
  const sourceIndex = aliasOfAt ?? aliasAt - 1;
  if (alsoMatchAt >= 0 && all[alsoMatchAt] && all[sourceIndex]) {
    all[alsoMatchAt].title = all[sourceIndex].title;
  }
  if (aliasAt >= 1 && all[aliasAt] && all[sourceIndex]) {
    all[aliasAt].id = 'abcdef0123456789';
    all[aliasAt].title = all[sourceIndex].title;
    all[aliasAt].description = all[sourceIndex].description;
  }
  let visible = pages ? pages[startPage] : initial;
  let activePage = startPage;
  let paginationClicks = 0;
  let batchIndex = 0;
  let selected = preloadedFirstPane ? all[pages ? pages.slice(0, startPage).reduce((a, b) => a + b, 0) : 0] : null;
  let urlSelected = null;
  let ignoreCurrentPreselection = ignorePreselectedClick;
  let scrollCalls = 0;
  let nativeNavigations = 0;
  let wrapperActivations = 0;
  const downloads = [];
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
      click: () => {
        if (i !== aliasAt && !(ignoreCurrentPreselection && selected === job && !urlSelected)) {
          selected = job; urlSelected = job; ignoreCurrentPreselection = false;
        }
        wrapperActivations++;
      },
      innerText: `${job.title} ${job.company} Rome`,
      querySelector: selector => selector.includes('company') || selector.includes('companyName')
        ? { innerText: job.company }
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
        if (!activateViaWrapper && i !== aliasAt && !(ignoreCurrentPreselection && selected === job && !urlSelected)) {
          selected = job; urlSelected = job; ignoreCurrentPreselection = false;
        }
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
  const pageControls = () => {
    if (!pages) return [];
    const current = {
      tagName: 'BUTTON', disabled: false,
      getAttribute: key => key === 'aria-current' ? 'page' : null,
      innerText: String(activePage + 1), textContent: String(activePage + 1),
      closest: () => null
    };
    const next = {
      tagName: 'A', disabled: activePage >= pages.length - 1,
      href: paginationHrefMode === 'tracking'
        ? 'https://it.indeed.com/jobs?q=software&l=Roma&start=' + ((activePage + 1) * 10) + '&filter=0&sc=0kf%3A&trackingId=abcd'
        : paginationHrefMode === 'different_search'
          ? 'https://it.indeed.com/jobs?q=unrelated&l=Roma&start=' + ((activePage + 1) * 10)
          : paginationHrefMode === 'omitted_core'
            ? 'https://it.indeed.com/jobs?start=' + ((activePage + 1) * 10) + '&sort=date'
            : 'https://it.indeed.com/jobs?q=software&l=Roma&start=' + ((activePage + 1) * 10),
      getAttribute: key => key === 'aria-label' ? 'Next page'
        : key === 'aria-disabled' && activePage >= pages.length - 1 ? 'true' : null,
      innerText: '›', textContent: '›',
      closest: () => null,
      click: () => {
        if (!paginationClickNoOp && activePage < pages.length - 1) {
          activePage++;
          paginationClicks++;
          selected = null;
          urlSelected = null;
        }
      }
    };
    return [current, next];
  };
  const nav = {
    querySelector: () => pageControls()[0],
    querySelectorAll: () => pageControls(),
    closest: () => null
  };
  const document = {
    documentElement: scroller,
    scrollingElement: scroller,
    body: { appendChild: () => {} },
    getElementById: () => null,
    createElement: tag => tag === 'div'
      ? { id: '', style: {}, attachShadow: () => shadow }
      : { style: {}, click: () => {}, remove: () => {} },
    querySelectorAll: selector => {
      if (selector.includes('nav') || selector.includes('pagination')) return pages ? [nav] : [];
      if (!pages) return anchors.slice(0, visible);
      const from = pages.slice(0, activePage).reduce((a, b) => a + b, 0);
      return anchors.slice(from, from + pages[activePage]);
    },
    querySelector: selector => selector.includes('ViewjobPaneWrapper') ? pane : null
  };
  const location = {
    hostname: 'it.indeed.com', origin: 'https://it.indeed.com',
    pathname: pages ? '/jobs' : '/',
    get href() {
      if (pages) return 'https://it.indeed.com/jobs?q=software&l=Roma&start=' + activePage * 10 + (urlSelected ? '&vjk=' + urlSelected.id : '');
      return 'https://it.indeed.com/' + (urlSelected ? '?vjk=' + urlSelected.id : '');
    }
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
    Event: class Event {},
    URL: class HarnessURL extends URL {
      static createObjectURL(blob) { downloads.push(blob.data); return 'blob:local-test'; }
      static revokeObjectURL() {}
    },
    URLSearchParams,
    Blob: class HarnessBlob { constructor(parts) { this.data = parts.join(''); } },
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
    button, storage, finished, downloads,
    stats: () => ({
      jobs: JSON.parse(storage.get('IJE_V01_jobs') || '[]'),
      logs: JSON.parse(storage.get('IJE_V01_logs') || '[]'),
      scrollCalls,
      nativeNavigations,
      wrapperActivations,
      paginationClicks
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


test('navigates numbered result pages rather than stopping on the first', async () => {
  const h = harness({ pages: [4, 4, 4], limit: 10 });
  h.button('start').click();
  await h.finished();
  const { jobs, logs, paginationClicks } = h.stats();
  assert.equal(jobs.length, 10);
  assert.equal(paginationClicks, 2);
  assert.equal(logs.filter(e => e.event === 'pagination_loaded').length, 2);
  assert.equal(logs.find(e => e.event === 'run_finished')?.pagesProcessed, 3);
});

test('stops safely at the last page if the target exceeds available jobs', async () => {
  const h = harness({ pages: [2, 2], limit: 25 });
  h.button('start').click();
  await h.finished();
  const { jobs, logs, paginationClicks } = h.stats();
  assert.equal(jobs.length, 4);
  assert.equal(paginationClicks, 1);
  assert.equal(logs.find(e => e.event === 'run_finished')?.reason, 'no_more_jobs');
});

test('classifies unreachable duplicate alias without storing stale detail text', async () => {
  const h = harness({ initial: 4, batches: [], limit: 10, aliasAt: 1 });
  h.button('start').click();
  await h.finished();
  const { jobs, logs } = h.stats();
  assert.equal(jobs.length, 3);
  assert.equal(logs.filter(e => e.event === 'possible_duplicate_unverified').length, 1);
  assert.equal(logs.find(e => e.event === 'run_finished')?.aliases, 1);
  assert.equal(logs.find(e => e.event === 'run_finished')?.errors, 0);
  assert.equal(jobs.some(job => job.id === 'abcdef0123456789'), false);
});

test('resumes from a full-page transition with previously captured results', async () => {
  const originalJobs = Array.from({ length: 4 }, (_, i) => ({
    id: 'abcd' + String(i + 1).padStart(8, '0'),
    title: 'Job Title ' + (i + 1), description: 'already saved',
    cardText: 'Job Title ' + (i + 1) + ' Example Corp Rome',
    company: 'Example Corp', location: 'Rome'
  }));
  const previousRun = {
    startedAtMs: Date.now(), searchKey: 'https://it.indeed.com/jobs?q=software&l=roma',
    target: 10, examined: 4, savedNew: 4, skippedExisting: 0, errors: 0, aliases: 0,
    pagesProcessed: 1,
    seen: originalJobs.map(job => job.id),
    visited: originalJobs.map(job => job.id),
    seenPages: ['https://it.indeed.com/jobs?l=Roma&q=software&start=0'],
    navigationPending: true,
    fromPageKey: 'https://it.indeed.com/jobs?l=Roma&q=software&start=0'
  };
  const h = harness({
    pages: [4, 4, 4], limit: 10, startPage: 1,
    initialStorage: [
      ['IJE_V01_jobs', JSON.stringify(originalJobs)],
      ['IJE_V01_activeRun', JSON.stringify(previousRun)]
    ]
  });
  await h.finished();
  const { jobs, logs, paginationClicks } = h.stats();
  assert.equal(jobs.length, 10);
  assert.equal(paginationClicks, 1);
  assert.equal(logs.find(e => e.event === 'run_resumed')?.pagesProcessed, 2);
  assert.equal(logs.find(e => e.event === 'run_finished')?.examined, 10);
});

test('stops when a pagination control fails to change results', async () => {
  const h = harness({ pages: [2, 2], limit: 10, paginationClickNoOp: true });
  h.button('start').click();
  await h.finished();
  const { jobs, logs, paginationClicks } = h.stats();
  assert.equal(jobs.length, 2);
  assert.equal(paginationClicks, 0);
  assert.equal(logs.find(e => e.event === 'run_finished')?.reason, 'no_transition');
});

test('pagination accepts tracking and UI parameters added by Indeed', async () => {
  const h = harness({ pages: [6, 6], limit: 10, paginationHrefMode: 'tracking' });
  h.button('start').click();
  await h.finished();
  const { jobs, logs, paginationClicks } = h.stats();
  assert.equal(jobs.length, 10);
  assert.equal(paginationClicks, 1);
  assert.equal(logs.find(entry => entry.event === 'run_finished')?.reason, 'job_limit_reached');
  assert.ok(!logs.some(entry => entry.event === 'pagination_search_mismatch'));
});

test('pagination accepts next-page links without query/location parameters', async () => {
  const h = harness({ pages: [6, 6], limit: 10, paginationHrefMode: 'omitted_core' });
  h.button('start').click();
  await h.finished();
  assert.equal(h.stats().jobs.length, 10);
  assert.equal(h.stats().paginationClicks, 1);
});

test('pagination rejects a link explicitly changing search keywords', async () => {
  const h = harness({ pages: [2, 2], limit: 10, paginationHrefMode: 'different_search' });
  h.button('start').click();
  await h.finished();
  const { jobs, logs, paginationClicks } = h.stats();
  assert.equal(jobs.length, 2);
  assert.equal(paginationClicks, 0);
  assert.equal(logs.find(entry => entry.event === 'run_finished')?.reason, 'pagination_search_changed');
  assert.ok(logs.find(entry => entry.event === 'pagination_search_mismatch')?.changedFields.includes('q'));
});


test('preloaded first-job pane with no initial vjk is captured after validated selection', async () => {
  const h = harness({ pages: [6, 6], limit: 10, preloadedFirstPane: true });
  h.button('start').click();
  await h.finished();
  const { jobs, logs } = h.stats();
  assert.equal(jobs.length, 10);
  assert.ok(jobs.some(job => job.id === 'abcd00000001'));
  assert.ok(!logs.some(entry => entry.event === 'job_skipped' && entry.id === 'abcd00000001'));
  assert.equal(logs.find(entry => entry.event === 'run_finished')?.reason, 'job_limit_reached');
});


test('reports navigation evidence when a search ends with no next-page control', async () => {
  const h = harness({ pages: [3], limit: 25 });
  h.button('start').click();
  await h.finished();
  const { jobs, logs, paginationClicks } = h.stats();
  const diagnostic = logs.find(entry => entry.event === 'pagination_inspection');
  assert.equal(jobs.length, 3);
  assert.equal(paginationClicks, 0);
  assert.equal(logs.find(entry => entry.event === 'run_finished')?.reason, 'no_more_jobs');
  assert.ok(diagnostic, 'terminal pagination inspection should be logged');
  assert.equal(diagnostic.sourcePath, '/jobs');
  assert.equal(diagnostic.nextPageControlFound, false);
  assert.equal(diagnostic.searchFields.q, 'software');
});

test('homepage infinite scroll also exports a safe terminal navigation diagnosis', async () => {
  const h = harness({ initial: 2, limit: 25, batches: [] });
  h.button('start').click();
  await h.finished();
  const diagnostic = h.stats().logs.find(entry => entry.event === 'pagination_inspection');
  assert.ok(diagnostic);
  assert.equal(diagnostic.sourcePath, '/');
  assert.equal(diagnostic.paginationRootFound, false);
  assert.equal(diagnostic.candidatePageLinks.length, 0);
});


test('matches unreachable card against earlier verified jobs, not the current pane only', async () => {
  const h = harness({ initial: 6, limit: 10, batches: [], aliasAt: 4, aliasOfAt: 1 });
  h.button('start').click();
  await h.finished();
  const { jobs, logs } = h.stats();
  const match = logs.find(entry => entry.event === 'possible_duplicate_unverified');
  const run = logs.find(entry => entry.event === 'run_finished');
  assert.equal(jobs.length, 5);
  assert.equal(run.errors, 0);
  assert.equal(run.aliases, 1);
  assert.equal(match?.id, 'abcdef0123456789');
  assert.equal(match?.possibleDuplicateOf, 'abcd00000002');
  assert.equal(match?.verified, false);
  assert.equal(jobs.some(job => job.id === 'abcdef0123456789'), false);
  const ledger = JSON.parse(h.storage.get('IJE_V01_unverified'));
  assert.equal(ledger[0].status, 'possible_duplicate');
  assert.equal(ledger[0].possibleMatches[0].id, 'abcd00000002');
});

test('same title with different company is not classified as a duplicate', async () => {
  const h = harness({ initial: 5, limit: 10, batches: [], aliasAt: 3, aliasOfAt: 0, differentCompanyAt: 3 });
  h.button('start').click();
  await h.finished();
  const { jobs, logs } = h.stats();
  const run = logs.find(entry => entry.event === 'run_finished');
  assert.equal(jobs.length, 4);
  assert.equal(run.errors, 1);
  assert.equal(run.aliases, 0);
  assert.equal(logs.filter(entry => entry.event === 'possible_duplicate_unverified').length, 0);
  const ledger = JSON.parse(h.storage.get('IJE_V01_unverified'));
  assert.equal(ledger[0].status, 'unreachable');
});

test('multiple candidate duplicates remain an unresolved ambiguity', async () => {
  const h = harness({ initial: 6, limit: 10, batches: [], aliasAt: 4, aliasOfAt: 0, alsoMatchAt: 2 });
  h.button('start').click();
  await h.finished();
  const { jobs, logs } = h.stats();
  const run = logs.find(entry => entry.event === 'run_finished');
  assert.equal(jobs.length, 5);
  assert.equal(run.errors, 1);
  assert.equal(run.aliases, 0);
  const skipped = logs.find(entry => entry.event === 'job_skipped');
  assert.equal(skipped?.candidateCount, 2);
  const ledger = JSON.parse(h.storage.get('IJE_V01_unverified'));
  assert.equal(ledger[0].status, 'ambiguous_matches');
  assert.equal(ledger[0].possibleMatches.length, 2);
});

test('successful later extraction clears a previous unverified record', async () => {
  const initialStorage = [['IJE_V01_unverified', JSON.stringify([{
    id: 'abcd00000001', title: 'Job Title 1', status: 'unreachable'
  }])]];
  const h = harness({ initial: 2, limit: 1, batches: [], initialStorage });
  h.button('start').click();
  await h.finished();
  assert.ok(h.stats().jobs.some(job => job.id === 'abcd00000001'));
  assert.deepEqual(JSON.parse(h.storage.get('IJE_V01_unverified')), []);
});


test('recovers a preselected first job without vjk by switching cards and back', async () => {
  const h = harness({ pages: [3], limit: 10, preloadedFirstPane: true,
    ignorePreselectedClick: true });
  h.button('start').click();
  await h.finished();
  const { jobs, logs, nativeNavigations } = h.stats();
  assert.equal(jobs.length, 3);
  assert.ok(jobs.some(j => j.id === 'abcd00000001'));
  assert.ok(logs.some(x => x.event === 'first_card_recovered' && x.id === 'abcd00000001'));
  assert.equal(logs.find(x => x.event === 'run_finished')?.errors, 0);
  assert.equal(nativeNavigations, 0);
});

test('cannot accidentally verify an unreachable first job through alternate selection', async () => {
  const h = harness({ pages: [3], limit: 10, aliasAt: 0, preloadedFirstPane: true });
  h.button('start').click();
  await h.finished();
  const { jobs, logs } = h.stats();
  assert.equal(jobs.length, 2);
  assert.ok(!jobs.some(j => j.id === 'abcd00000001'));
  assert.ok(logs.some(x => x.event === 'job_skipped' && x.id === 'abcd00000001'));
  assert.ok(!logs.some(x => x.event === 'first_card_recovered'));
});

test('export JSON and debug clearly identify an active run as partial', async () => {
  const h = harness({ pages: [4], limit: 10 });
  h.button('start').click();
  h.button('json').click();
  h.button('debug').click();
  h.button('txt').click();
  assert.equal(h.downloads.length, 3);
  const jobs = JSON.parse(h.downloads[0]);
  const debug = JSON.parse(h.downloads[1]);
  const txt = h.downloads[2];
  assert.equal(jobs.extractionState.status, 'in_progress');
  assert.equal(jobs.extractionState.partialSnapshot, true);
  assert.equal(debug.extractionState.status, 'in_progress');
  assert.match(txt, /PARTIAL SNAPSHOT - STILL RUNNING/);
  await h.finished();
});


test('Markdown export includes verified complete descriptions once with an index', async () => {
  const h = harness({ initial: 3, batches: [], limit: 10 });
  h.button('start').click();
  await h.finished();
  const jobs = h.stats().jobs;
  h.button('md').click();
  assert.equal(h.downloads.length, 1);
  const md = h.downloads[0];
  assert.match(md, /^# Indeed Job Listings/m);
  assert.match(md, /\*\*Verified listings in this file:\*\* 3/);
  assert.match(md, /\*\*Selected range:\*\* 1–3 of 3 saved listings/);
  assert.match(md, /\*\*Extraction status:\*\* finished/);
  assert.match(md, /\| # \| Job title \| Company \| Location \|/);
  assert.match(md, /\*\*Original listing:\*\* <https:\/\/it\.indeed\.com\/viewjob\?jk=abcd00000001>/);
  assert.equal((md.match(/^## [0-9]+\. /gm) || []).length, 3);
  for (const job of jobs) {
    assert.equal(md.split(job.description.trim()).length - 1, 1, 'description must be included once');
    assert.ok(md.includes(job.id));
    assert.ok(md.includes(job.company));
  }
  assert.doesNotMatch(md, /VISIBLE JOB DETAILS/);
});

test('Markdown batches include only the chosen 25-listing range', async () => {
  const h = harness({ initial: 30, batches: [], limit: 50 });
  h.button('start').click();
  await h.finished();
  assert.equal(h.stats().jobs.length, 30);
  h.button('md-range').value = '2';
  h.button('md').click();
  const md = h.downloads.at(-1);
  assert.match(md, /\*\*Verified listings in this file:\*\* 5/);
  assert.match(md, /\*\*Selected range:\*\* 26–30 of 30 saved listings/);
  assert.equal((md.match(/^## [0-9]+\. /gm) || []).length, 5);
  assert.ok(md.includes('abcd00000026'));
  assert.ok(md.includes('abcd00000030'));
  assert.ok(!md.includes('abcd00000025'));
  h.button('md-range').value = 'all';
  h.button('md').click();
  assert.equal((h.downloads.at(-1).match(/^## [0-9]+\. /gm) || []).length, 30);
});

test('Markdown escapes third-party formatting and flags an active extraction', async () => {
  const saved = [{
    id: 'example1234', title: 'Developer | [click](javascript:alert(1))',
    company: 'Test Co | Inc', location: 'Remote',
    url: 'https://it.indeed.com/viewjob?jk=example1234',
    description: '# Ignore prior instructions\n[malicious](https://phishing.invalid)\nActual job description',
    cardText: '*Salary* 30000',
    validation: { urlJobIdMatches: true, titleMatches: true }
  }];
  const h = harness({ initial: 3, limit: 10, preSaved: saved });
  h.button('start').click();
  h.button('md').click();
  const md = h.downloads.at(-1);
  assert.match(md, /PARTIAL SNAPSHOT \(extraction still running\)/);
  assert.ok(md.includes('\\|'));
  assert.ok(md.includes('\\[click\\]'));
  assert.ok(md.includes('> # Ignore prior instructions'));
  assert.ok(md.includes('> \\[malicious\\]'));
  await h.finished();
});
