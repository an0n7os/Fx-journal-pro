# Excel, frontend and shared-journal follow-up — 31 October 2026

This updates the earlier audit report. Current automated result: 25 suites, 609/609 checks passed. npm audit: 0 reported vulnerabilities. TypeScript checking, frontend production build and built-server startup tests passed. No production accounts, live payments or broker logins were used.

## Shared journal fix

- Root cause: share creation did not pass the selected dashboard account; public reads merged every portfolio belonging to the owner. New share links persist and validate accountId, and filter trades to that account. A viewer's session cannot change the link owner's data. Forged cross-user account selections are rejected.
- Shared statistics, equity-curve P/L and journal rows now use profit plus signed commission and swap. Gross profit and costs are preserved in the journal payload; the net amount is separate. The nested performance chart receives the same net P/L.
- New links default to All Time rather than three months. A deliberately chosen 1/3/6/12-month window still filters the shared view, and therefore need not equal an all-time dashboard.
- Legacy links created without account scope remain compatible with their original all-portfolio behavior. For clients with several accounts, revoke and regenerate the link from the desired dashboard account. The old account choice cannot be reconstructed safely from those links.
- Added multi-portfolio, foreign-account rejection, commission/swap and chart-total regressions. API checks passed; live production shared links were not fetched or modified.

## Excel / CSV

- Replaced ExcelJS with write-excel-file; removed 94 old packages. Workbook layout retains branded title, account/period metadata, journal rows, summary, totals and footer. Columns now explicitly include commission, swap and net P/L. Headers are frozen, text wraps and numeric values remain numeric.
- Net P/L includes signed commission and swap. Trading summary/totals exclude deposits and withdrawals. Zero-profit trades are not classified as losing trades.
- An independent XLSX reader verified decimal prices, Malayalam/multiline notes, formula-shaped text, totals, empty exports and 1,500-row exports. Nonfinite numbers fail with a user-visible message rather than silently producing a corrupt workbook.
- CSV text formula injection is neutralized; negative numeric values remain numbers. CSV uses its own tiny module and does not download the XLSX writer.
- Export chunk: 64125 bytes (about 64 KB), previously about 940 KB. This is built JavaScript size, not the generated spreadsheet size. Native Excel/LibreOffice opening was not verified.

## Frontend

- Public visitors load a small route shell and public page; dashboard charts/admin/trading components load only when the existing workspace/auth bootstrap is needed.
- Stored sessions, cookie-only sessions, protected routes, OAuth callbacks and shared/legal routes retain the workspace bootstrap. Cookie checks do not authenticate users in the browser; server authorization remains authoritative.
- Public-page JavaScript dependency closure: 799510 bytes versus 2337173 bytes in the prior local build (66% smaller). This includes the lazy public-page chunk and its static dependencies, excludes CSS and third-party network scripts, and is not a measured LCP or real-device speed result.
- Added a build-manifest budget check to CI: public routes must not eagerly import dashboard/chart/export chunks, public JS stays below 1 MB and the XLSX module below 100 KB. Build emits no oversized-chunk warning at the existing threshold.
- The built /features page was opened and visibly rendered in Chrome. Public Sign In navigation opened the login modal. Authenticated UI, download-click and mobile viewport checks remain incomplete because subsequent computer-use observation could not obtain the foreground process id. No browser security checks were bypassed.

## Additional runtime issue fixed

The production ESM bundle used esbuild's synthetic require to load node:sqlite, which failed and caused auth migration startup to exit. Auth now uses Node createRequire(import.meta.url). The production guard suite compiles and starts the actual ESM bundle rather than testing only the tsx development entry; all three checks pass. An isolated built-site server also started successfully after this fix.

## Still requires live verification

- Actual payment capture/refund/provider webhooks, delivered email and Google OAuth.
- Real MT5 terminal/broker compatibility, production database migrations/backups and restore.
- Full authenticated desktop/mobile UI QA, real-device performance and native Excel opening.
- Deployment and GitHub Actions execution. These follow-up changes are local; they have not been pushed/deployed.

## Re-run

- npm run lint
- npm run build
- npm run check:frontend
- npm run test:audit
- npm audit

## Customer-only sharing verification

Latest full regression: 26 suites, 611/611 checks passed. Shared trade selection now checks both explicit trade ownership and portfolio ownership, rejects conflicting legacy rows, and never substitutes viewer data. A deleted/unowned portfolio returns 404. Database read errors return 503 instead of a misleading zero summary. Anonymous visitors, signed-in viewers, multi-portfolio owners, forged account choices, net P/L and chart totals are covered by tests. Production data was not inspected or modified.
