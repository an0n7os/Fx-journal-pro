# Connecting MetaTrader 5

FX Journal Pro imports MT5 trades through an Expert Advisor: a small read-only
program that runs inside the customer's own terminal and posts closed trades to
their account. It needs no broker password, no third-party service and no extra
infrastructure — which is why it is the only method offered.

Cloud sync (the "Trading Password" method) is switched off. See
[Why cloud sync is off](#why-cloud-sync-is-off) below.

## What the customer does

Each portfolio account gets its own EA file, carrying a token that ties it to
that one account. Downloading it from another account's page gives a different
file; the token cannot be reused across accounts.

1. **Allow the connection.** In MT5: `Tools → Options → Expert Advisors`, tick
   **Allow WebRequest for listed URL**, and add the host the page shows —
   `www.fxjournalpro.com` in production. The host only, no `https://` and no
   path.
2. **Install the EA.** Download the `.mq5` from the MT5 tab. Put it in
   `MQL5/Experts` — `File → Open Data Folder` opens the right place. Open it in
   MetaEditor and press **F7** to compile. It should report `0 errors, 0
   warnings`.
3. **Attach it to a chart.** Any chart, any symbol; it does not read the chart.
   Turn on **AutoTrading** in the toolbar. Within a few seconds the dashboard
   moves to Connected and the full history imports.

The page polls, so it updates on its own — no refresh needed.

## What it does and does not do

The EA contains no trading functions at all. It cannot open, modify or close a
position. It reads account and deal history and posts it.

Only **closed** positions become journal trades. An open position is sent and
held, and appears once it closes — a half-finished trade has no exit price or
result to record.

Every request is signed: `HMAC-SHA256` over
`"<iso timestamp>.<accountId>.<body>"`, keyed on the SHA-256 of the account's EA
token. The server rejects a wrong token, a signature that does not match the
body, and a timestamp outside its replay window, so a captured request cannot
be replayed or edited in flight.

## When it does not connect

The EA prints to the terminal's **Experts** tab. That log is the first place to
look.

| What the customer sees | What it means |
| --- | --- |
| `WebRequest is blocked` / `URL is not in the allow list` | Step 1 was missed, or the host was entered with `https://` or a trailing path. Enter the bare host. |
| `HMAC verification failed. Check that your PC clock (GMT) is correct.` | The machine's clock is off far enough to fall outside the replay window. Fix the system clock, including the time zone. |
| `EA_AUTH_FAILED` | The file is for a different portfolio account, or the token was reset after this file was downloaded. Download a fresh EA and recompile. |
| `EA_TOKEN_REVOKED` | Same — **Reset Token** invalidates every EA file issued before it. |
| Compiles, attached, still "Waiting for MT5" | AutoTrading is off, or the EA is attached but not permitted. Check for the smiley face on the chart. |
| Terminal login does not match | The portfolio account records an MT5 login that differs from the terminal's. Clear it on the account, or attach on the matching terminal. |

Resetting the token is the safe move whenever a file's origin is unclear: it
invalidates every previously issued EA for that account and nothing else.

## Why cloud sync is off

Cloud sync would connect to the broker on the customer's behalf using their
investor password, with no EA to install. The code for it exists, and it does
not run:

- The recurring sync loop, `cloudSyncLoopTick`, is written and never called.
- `startCloudWorker` returns immediately on serverless. Netlify freezes an
  instance as soon as it responds, so a `setInterval` never fires.

Before this was gated, `POST /api/mt5/cloud/connect` answered `200` and left
the account at **Validating** forever, while the UI offered it as the easier of
the two methods. A customer who chose it was simply stuck.

It now requires `MT5_CLOUD_SYNC_ENABLED=true`, a non-serverless host and
`META_API_TOKEN`. Without all three the route answers `503
CLOUD_WORKER_UNAVAILABLE` and the UI marks the method unavailable rather than
inviting someone into it.

Turning it on is not a flag flip. It needs a host that runs a long-lived
process, the loop armed, and `cloudSyncLoopTick` changed to enumerate cloud
accounts from the database — it currently walks `userDatabases`, the in-memory
cache, so an account whose owner has not made a request since the last restart
would never sync. MetaApi is also billed per account.

## Testing it

`tests/mt5-ea.test.mjs` drives the endpoints exactly as the generated `.mq5`
does, including the signature, and covers the path end to end: download,
authenticate, validate, deals becoming trades with the right direction, a
replayed batch inserting nothing, an open position waiting for its close,
heartbeat, and the refusals for a wrong token, a stale timestamp, a forged
signature and another customer's session.

```bash
node --env-file-if-exists=.env tests/mt5-ea.test.mjs
```

What that suite cannot cover is MetaTrader itself: whether the `.mq5` compiles
in MetaEditor and whether WebRequest reaches the server from a real terminal.
Those need one manual run on a machine with MT5 installed.
