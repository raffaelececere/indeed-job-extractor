# Indeed Job Extractor

**Version 0.3.0 — public beta (six simulated-DOM tests passed; revalidation on live Indeed required).**

A standalone [Tampermonkey](https://www.tampermonkey.net/) userscript for collecting Indeed job listings, including their full visible descriptions, to review in JSON or TXT format. It operates in your browser through Indeed's existing interface; no API key, server, or build process is needed.

This is an independent, unofficial project and is not affiliated with, endorsed by, or sponsored by Indeed.

## Features

- **Configurable collection limit:** 10, 25, 50, 100, 250, or 500 *new listings examined per run*.
- **Bounded infinite-scroll discovery:** when currently discovered jobs are exhausted, attempts to scroll the results list to reveal further cards; stops after five attempts without any new job IDs.
- **Sequential extraction:** selects one job at a time using the existing Indeed UI, rather than initiating competing requests to the same mutable details pane.
- **Guarded card activation (v0.3):** cancels native link navigation when programmatically selecting a job. If the regular selection does not update the pane, tries a non-link card wrapper instead; a failed selection is logged rather than blindly following the job URL.
- **Interrupted-run diagnostics:** persists the active-run marker so an unexpected page navigation can be identified on the next load.
- **Job validation:** checks the `data-jk` card ID against the `vjk` URL parameter, verifies that the details-pane heading begins with the expected title, waits for stable description content, and rejects uncertain captures.
- **Duplicate detection:** preserves saved entries by Indeed job ID and skips them in future runs.
- **Persistent local storage:** retains extracted jobs and configuration between runs and browser refreshes.
- **Manual STOP and bounded fail-safe:** stops after three consecutive extraction errors, at the chosen limit, after repeated empty scroll attempts, or at a 45-minute maximum run duration.
- **Exports:** JSON, human-readable TXT and a separate structured debugging log.
- **Floating, draggable, minimizable UI.**

## Installation

1. Install the Tampermonkey browser extension.
2. Create a new script in Tampermonkey.
3. Replace the template with [`indeed-job-extractor.user.js`](indeed-job-extractor.user.js) and save.
4. Open Indeed in a desktop browser and navigate to a page with job result cards and a job-details pane.
5. Refresh the tab to display the **Indeed Job Extractor** panel.

The script is matched to `indeed.com` and its subdomains. It was developed using DOM observations on `it.indeed.com` in October 2026. Different countries, accounts and UI variants may require additional selector support.

## Usage

1. Choose a limit in **New jobs to examine** (for initial testing, choose **10 jobs**).
2. Press **START EXTRACTION** and keep the Indeed tab open.
3. The script processes newly encountered listings, then attempts to scroll for more when the current batch is exhausted.
4. It stops when your limit is reached, there are no more detectable results, you press **STOP**, or a safety threshold is reached.
5. Download **EXPORT JSON**, **EXPORT TXT**, or **DEBUG LOG**. Exported jobs remain available locally until you select **CLEAR SAVED**.

The limit counts *newly examined listings in the current run*, including unsuccessful extraction attempts. Listings saved on a previous run are skipped and do not consume the selected limit. The total exported count can therefore be larger than the per-run limit.

## Example JSON structure

```json
{
  "generator": "Indeed Job Extractor",
  "version": "0.3.0",
  "exportedAt": "2026-10-10T16:00:00.000Z",
  "jobCount": 1,
  "jobs": [
    {
      "id": "example-job-id",
      "title": "Software Developer",
      "company": "Example Company",
      "location": "Remote",
      "sponsored": false,
      "url": "https://it.indeed.com/viewjob?jk=example-job-id",
      "sourceDomain": "it.indeed.com",
      "sourcePath": "/jobs",
      "extractedAt": "2026-10-10T16:00:00.000Z",
      "description": "Full visible job description...",
      "descriptionLength": 31,
      "detailText": "...",
      "cardText": "...",
      "validation": {
        "urlJobIdMatches": true,
        "titleMatches": true,
        "stableForMs": 450
      }
    }
  ]
}
```

The example is illustrative, not a real exported listing. Depending on Indeed's UI, `company` or `location` can be `null`; details-pane and card text are also saved as fallbacks.

## Reliability and limitations

Indeed is a dynamic website. Not all layouts provide the same selectors, loading behaviour, or `vjk` URL parameter. The script is intentionally conservative: if the selected ID and details cannot be associated confidently, it skips the job rather than silently attaching a wrong description.

- Only DOM-loaded job cards accessible from the current page can be discovered. The script does **not** crawl the entire Indeed database or automatically change search filters.
- Infinite scrolling is **best effort**, dependent on the actual results-list scroll container and Indeed's UI behaviour. Some searches may paginate, require a button, or stop loading more items.
- **Page navigation is a known compatibility risk.** v0.2.0 followed a native job link during an extraction on the Italian homepage. v0.3.0 adds a cancellation guard and stops on detected route changes, but this needs testing on real pages: third-party page handlers may still initiate navigation.
- “No more jobs detected” means no new job IDs were detected within the configured bounded attempts, not proof that no other jobs exist online.
- The description is the **visible DOM text**, not a guarantee of all information on external application pages.
- Some listings may share titles or appear in sponsored placements. Job ID validation and conservative failure handling reduce, but cannot completely eliminate, UI-race risks.
- Results from the Italian Indeed desktop homepage informed the initial DOM selectors. Browser testing is still required before a stable release.

## Privacy and usage

Extraction is performed locally in the browser. The userscript makes no direct background HTTP requests, loads no external script modules, and contains no API keys or credentials. Data is not transmitted to the author. Exports and debug logs may contain information about job listings; inspect them before sharing.

Use responsibly and follow Indeed's applicable terms and policies. This software is provided for personal job-search workflows and testing, without a guarantee of compatibility or availability.

## Development

No dependencies are required for browser usage. With Node.js installed, run the lightweight simulated-DOM tests:

```bash
node --check indeed-job-extractor.user.js
node --test tests/smoke.test.js
```

These tests cover limited extraction, progressive discovery, automatic stopping, saved-ID deduplication, native link-navigation prevention and a non-link activation fallback, **not** a real Indeed session. A live validation pass should confirm the details-pane synchronization, DOM behaviour and scrolling implementation before increasing the collection limit.

## Project structure

```text
indeed-job-extractor/
├── indeed-job-extractor.user.js
├── README.md
└── tests/
    └── smoke.test.js
```

## Author

Raffaele Marco Cecere — [GitHub @raffaelececere](https://github.com/raffaelececere)