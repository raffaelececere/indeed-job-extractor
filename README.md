# Indeed Job Extractor

**Version 0.4.5 — beta.** Pagination and sequential extraction have been tested on the Italian desktop site. The new v0.4.5 duplicate-matching correction passes simulated-DOM tests and requires a live re-test.

A lightweight [Tampermonkey](https://www.tampermonkey.net/) userscript for collecting job listings and their visible full descriptions from Indeed. It runs locally in your browser and exports structured JSON, readable TXT, and a diagnostic JSON log. No API key, server, third-party analytics, or build process is required.

Independent, unofficial project. Not affiliated with, endorsed by, or sponsored by Indeed.

## Features

- **Bounded job target:** choose 10, 25, 50, 100, 250, or 500 **new successfully saved listings**. An unresolvable card does not use up the saved-job quota; the script also caps the number of attempts to prevent endless runs.
- **Two discovery modes:** detects and follows the existing **numbered pagination controls** on `/jobs` searches; uses **bounded infinite-scroll discovery** on homepage feeds without pagination. It does not guess or fabricate page URLs.
- **Full-page pagination resume:** checkpoints the extraction before clicking a Next Page link and resumes on the next `/jobs` page after a full browser navigation, provided the search or expected pagination destination matches. Also supports in-page pagination updates.
- **Validated sequential extraction:** activates job cards one by one without following their native links, waits for the detail pane, matches `data-jk` to the selected `vjk` URL parameter and checks the title and stability of the description.
- **Conservative duplicate review:** keeps previously saved entries by Job ID. When a card cannot be opened, searches **all verified saved listings** for one unambiguous title/company/location match (or exact result-card fingerprint), rather than comparing only with the active detail pane. Such a match is recorded as an **unverified possible duplicate**; it is never marked as a successful extraction. Ambiguous or unmatched cards remain failures requiring review.
- **Robust controls:** STOP, consecutive-failure cutoff, 45-minute run timeout, maximum 60 visited result pages, and up to five unsuccessful infinite-scroll discovery attempts.
- **Persistent results:** exported jobs survive page changes, refreshes, and userscript upgrades. STOP preserves partial results.
- **Exports:** JSON, TXT, and DEBUG LOG. Draggable/minimizable floating panel.

## Install and update

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. [Open the userscript](https://raw.githubusercontent.com/raffaelececere/indeed-job-extractor/main/indeed-job-extractor.user.js) and install it with Tampermonkey, or replace your existing Indeed Job Extractor script with the file from this repository.
3. Open Indeed and navigate to its Homepage or a job search page with listings. Refresh the tab if necessary.
4. Confirm the floating panel shows **v0.4.5**. **Do not install two copies** of the script.

Tampermonkey update metadata points to the `main` branch of this repository. Earlier saved jobs from v0.1–v0.3 use the same local storage namespace and remain available after upgrading. **Do not click CLEAR SAVED unless you intend to delete your stored jobs and debug history.**

## Usage

1. Select the desired number in **New jobs to save**. Start with **10 jobs** while testing a new Indeed layout.
2. Click **START EXTRACTION** and leave the Indeed tab open.
3. The script collects new cards sequentially. On `/jobs`, when the current results page is exhausted, it looks for the site's genuine **Next Page** control. On feeds without pagination, it attempts bounded scrolling.
4. Observe the separate counters for **Saved this run**, **Examined**, **Discovered**, **Saved total**, **Possible duplicates**, **Errors**, and **Pages**.
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

If a card cannot be selected, it is *not* automatically treated as a valid job: if it uniquely resembles an already verified listing, it is logged as `possible_duplicate_unverified`, regardless of which other job is selected. This is a *possible* match based on card metadata, not proof that the two Job IDs represent the same posting. Cards with multiple matches or no match are reported as `job_skipped`. All unverified cards are retained in the DEBUG export's `unverifiedCards` array. This conservative behavior prevents an incorrect job/description association but cannot guarantee recovery of every displayed card.

The userscript targets `indeed.com` and its subdomains. It was developed using the Italian desktop site in October 2026. **Other countries, accounts, layouts and mobile interfaces have not been validated.** Selectors and navigation controls may change without notice. Review exported data and follow Indeed's applicable terms and policies.

## Version 0.4.5: pagination guard correction

A real `/jobs` debug run of v0.4.0 saved 15 listings, then ended with `pagination_search_changed` before clicking the next-page control. The guard compared *all* non-page URL parameters. Indeed may add/remove tracking or UI parameters between result pages, which incorrectly triggered the stop.

v0.4.5 now rejects explicit changes in the actual search criteria while tolerating added or removed URL parameters on a verified pagination control. When a genuine search-criteria mismatch is detected, the DEBUG LOG records the changed parameter names and source/destination page keys. Checkpoint resume also accepts the exact expected next-page URL after a full reload. It still does not invent page URLs or follow unrelated domains. This correction is tested in the local simulated DOM but needs a new live Indeed validation.

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


### v0.4.5 — preloaded pane validation

Some paginated results pre-render the first job's description before the URL receives its `vjk` parameter. Earlier versions treated that *unchanged* description as stale and skipped the first result. The validator now accepts a stable title-matching description after its URL ID matches the target **only when no previously verified different job ID existed**. Stale descriptions from a known different job are still rejected.

If the search genuinely has fewer eligible results than the selected target, extraction stops at the end of the available pages; the target is a maximum, not a guarantee. Unresponsive cards with unverified IDs remain excluded from exports.


## v0.4.5 — Pagination diagnostics

When the extractor exhausts the current search without detecting another page, it now records a read-only `pagination_inspection` event and includes `paginationInspection` in the DEBUG JSON export. The snapshot contains the current search query/location, the presence of a pagination container and next-page control, and brief metadata for numbered page links and controls. It helps distinguish a genuine final page from an unsupported site layout without clicking uncertain links. The extraction/navigation behavior itself is unchanged from v0.4.2.


## v0.4.5 — Full-archive matching and unverified-card audit

A real 35-job run identified two unopenable card IDs (for titles already present in saved jobs), but the previous matcher checked only the job currently visible in the right pane. If another job was selected, the result was wrongly reported as an unrelated extraction error. v0.4.5 now checks the entire verified saved-job collection for a **unique** title/company/location or exact-card match. Multiple matches stay ambiguous; mere title similarity never suffices.

Successful extractions still require matching Job ID in the URL, matching title and stable detail content. Unreachable card IDs remain excluded from job exports. Their last observed reason, metadata, possible matches and status persist separately in `DEBUG LOG → unverifiedCards` for manual investigation. The check does not make Indeed provide a missing description or prove that alternative Job IDs are duplicates.

## v0.4.5 — Preselected first card and partial exports

On certain paginated layouts, the first listing appears in the details pane before its Job ID is placed in the URL. If clicking the preselected first card does not update `vjk`, the extractor now makes one bounded recovery attempt: it switches to a different visible card and then back. Both transitions must pass the original Job ID, title and stable-description checks. Otherwise the original listing remains unverified; descriptions are never guessed.

JSON and debug exports include the backward-compatible `extractionState` object. Files downloaded during an active run contain `status: "in_progress"` and `partialSnapshot: true`. TXT exports explicitly indicate that the snapshot is partial. A full result is available after `run_finished`.

This release preserves the existing storage prefix and the verified/unverified distinction. The retry is covered by simulated-DOM tests, but behavior across Indeed's different locales and client interfaces still requires real-browser verification.
