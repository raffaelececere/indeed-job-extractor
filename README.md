# Indeed Job Extractor

**Version 0.4.3 — beta.** The JavaScript passes automated simulated-DOM tests, but pagination and duplicate-card handling require confirmation on the live Indeed interface.

A lightweight [Tampermonkey](https://www.tampermonkey.net/) userscript for collecting job listings and their visible full descriptions from Indeed. It runs locally in your browser and exports structured JSON, readable TXT, and a diagnostic JSON log. No API key, server, third-party analytics, or build process is required.

Independent, unofficial project. Not affiliated with, endorsed by, or sponsored by Indeed.

## Features

- **Bounded job target:** choose 10, 25, 50, 100, 250, or 500 **new successfully saved listings**. An unresolvable card does not use up the saved-job quota; the script also caps the number of attempts to prevent endless runs.
- **Two discovery modes:** detects and follows the existing **numbered pagination controls** on `/jobs` searches; uses **bounded infinite-scroll discovery** on homepage feeds without pagination. It does not guess or fabricate page URLs.
- **Full-page pagination resume:** checkpoints the extraction before clicking a Next Page link and resumes on the next `/jobs` page after a full browser navigation, provided either the stable search terms or the expected next-page destination matches. Also supports in-page pagination updates.
- **Validated sequential extraction:** activates job cards one by one without following their native links, waits for the detail pane, matches `data-jk` to the selected `vjk` URL parameter and checks the title and stability of the description.
- **Duplicate/alias handling:** keeps previously saved entries by Job ID. If another unresponsive card matches an already saved selected listing by title, company and location (or exact card content), logs an **unverified duplicate alias** separately rather than saving stale description text under a second ID. Truly unverified cards remain visible as errors in the debug export.
- **Robust controls:** STOP, consecutive-failure cutoff, 45-minute run timeout, maximum 60 visited result pages, and up to five unsuccessful infinite-scroll discovery attempts.
- **Persistent results:** exported jobs survive page changes, refreshes, and userscript upgrades. STOP preserves partial results.
- **Exports:** JSON, TXT, and DEBUG LOG. Draggable/minimizable floating panel.

## Install and update

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. [Open the userscript](https://raw.githubusercontent.com/raffaelececere/indeed-job-extractor/main/indeed-job-extractor.user.js) and install it with Tampermonkey, or replace your existing Indeed Job Extractor script with the file from this repository.
3. Open Indeed and navigate to its Homepage or a job search page with listings. Refresh the tab if necessary.
4. Confirm the floating panel shows **v0.4.1**. **Do not install two copies** of the script.

Tampermonkey update metadata points to the `main` branch of this repository. Earlier saved jobs from v0.1–v0.3 use the same local storage namespace and remain available after upgrading. **Do not click CLEAR SAVED unless you intend to delete your stored jobs and debug history.**

## Usage

1. Select the desired number in **New jobs to save**. Start with **10 jobs** while testing a new Indeed layout.
2. Click **START EXTRACTION** and leave the Indeed tab open.
3. The script collects new cards sequentially. On `/jobs`, when the current results page is exhausted, it looks for the site's genuine **Next Page** control. On feeds without pagination, it attempts bounded scrolling.
4. Observe the separate counters for **Saved this run**, **Examined**, **Discovered**, **Saved total**, **Duplicate aliases**, **Errors**, and **Pages**.
5. Use **EXPORT JSON**, **EXPORT TXT** or **DEBUG LOG**. You can stop early without losing already saved results.

The target applies to **new saved listings during this run**. Previously saved Job IDs are skipped without using the target. If the search ends before enough new listings can be saved, the run ends below the selected target rather than making up results.

## Data fields

For every saved listing, the export attempts to include:

- Job ID, title, company, location, canonical Indeed link and source domain.
- Full visible job-description text and its length.
- Visible detail-pane text and original result-card text.
- Extraction timestamp and validation summary.
- Sponsored classification as inferred from the result card, **which may be inaccurate on some layouts**.

Not every page variant exposes every field. The userscript only saves a description after the source-card ID, URL ID and displayed title agree.

## Safety and limits

The script reads the **visible Indeed interface**; it does not issue background scraping requests. It never submits a job application, sends extracted data off-device, or fabricates an announcement that it cannot validate. Pagination clicks may cause ordinary website navigation, which is why run checkpoints are saved before changing pages.

If a card cannot be selected, it is *not* automatically treated as a valid job: if it appears to be an alternative ID for the currently selected saved job, it is logged as an `duplicate_alias_skipped`; otherwise it remains a `job_skipped` error. This conservative behavior prevents an incorrect job/description association but cannot guarantee recovery of every displayed card.

The userscript targets `indeed.com` and its subdomains. It was developed using the Italian desktop site in October 2026. **Other countries, accounts, layouts and mobile interfaces have not been validated.** Selectors and navigation controls may change without notice. Review exported data and follow Indeed's applicable terms and policies.

## v0.4.1 — pagination compatibility fix

An October 2026 live test of v0.4.0 extracted 15 of 16 visible jobs, with zero extraction errors, but stopped with `pagination_search_changed` before opening the next page. The previous guard compared incidental URL parameters as if they were part of the user's search.

The v0.4.1 guard accepts additional/missing tracking and UI parameters on a genuine next-page control, while rejecting explicit changes to search keywords, location and other stable criteria. The full-navigation checkpoint can resume at its exact expected destination even if pagination omits search fields in the new URL. A mismatch now records a diagnostic warning before stopping safely.

Three regression tests cover these URL variants. **Live pagination still needs verification**, especially across regional Indeed layouts and search filters.

## Development

```bash
node --check indeed-job-extractor.user.js
node --test tests/smoke.test.js
```

Tests use an in-process simulated DOM (not a live Indeed session). The suite covers scrolling, job limits, persistence, STOP, native-link click protection, wrapper selection, numbered pagination, reaching the last page, alias handling, full-navigation resume, and pagination timeout behavior.

## Structure

```text
indeed-job-extractor/
├── indeed-job-extractor.user.js
├── README.md
└── tests/
    └── smoke.test.js
```

## Author

Raffaele Marco Cecere — [GitHub @raffaelececere](https://github.com/raffaelececere)

## Fix in v0.4.3 — preloaded results pane

Some paginated searches already render their first job description before the URL receives its `vjk` parameter. Earlier versions could reject that correct pre-rendered description as unchanged. Now, when no previously **verified** job ID exists, the extractor accepts a stable description after verifying the selected URL Job ID and the title. Stale content from a different, previously verified Job ID is still rejected.

If fewer jobs are available than the requested target, extraction stops at the end of the available pages: the selection is a **maximum**, not a guarantee. Unreachable IDs are skipped rather than paired with unverified descriptions.


## v0.4.3 — Pagination diagnostics

When the extractor exhausts the current search without detecting another page, it now records a read-only `pagination_inspection` event and includes `paginationInspection` in the DEBUG JSON export. The snapshot contains the current search query/location, the presence of a pagination container and next-page control, and brief metadata for numbered page links and controls. It helps distinguish a genuine final page from an unsupported site layout without clicking uncertain links. The extraction/navigation behavior itself is unchanged from v0.4.2.
