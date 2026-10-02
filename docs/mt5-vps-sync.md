# MT5 VPS sync

A pool of MetaTrader 5 terminals on our own Windows VPS. Each terminal is
driven by a worker process that logs into one customer's account with their
**investor (read-only) password**, pulls deal history, hands it to the backend,
logs out, and takes the next job.

This replaces MetaApi. It is built to start at one terminal and one test
account, then scale to three to five by starting more worker processes.

## Shape

    customer clicks Connect/Sync
        POST /api/mt5/vps/connect      credentials stored encrypted, job queued
                                       account reads "Queued"
    worker on the VPS, in a loop
        POST /api/mt5/worker/claim     takes the oldest job, gets a 5-minute lease
                                       and that job's investor password
        mt5.initialize(login, password, server)
        mt5.history_deals_get(...)     only deals after the cursor
        POST /api/mt5/worker/sync      one batch, repeat for a long history
        POST /api/mt5/worker/heartbeat keeps the lease alive on a slow pull
        mt5.shutdown()                 terminal is free again
        POST /api/mt5/worker/complete  job DONE, account reads "Connected"

**The workers pull.** Every request is started by the worker, so the backend
needs no long-lived process and no background timer. That is what killed the
MetaApi path: its sync loop could not run on serverless at all. This works the
same on Netlify as on a box.

**Imports reuse the EA pipeline.** `/api/mt5/worker/sync` calls
`applyEaSyncPayload`, the same function the Expert Advisor path uses.
Deduplication by deal ticket, the incremental cursor, reconstructing positions
from deals and the balance handling are therefore the code that is already
proven, not a second implementation that can drift. Manual trades and existing
journal rows are untouched by all of this — a synced trade is keyed
`mt5ea_<accountId>_<positionId>` and nothing else writes that shape.

## Setting up the VPS

Everything below the terminal install is scripted. On the VPS, from the
`worker` directory:

    powershell -ExecutionPolicy Bypass -File setup-windows.ps1 `
        -WorkerToken  "<the backend's MT5_WORKER_TOKEN>" `
        -TerminalPath "C:\MT5\terminal1\terminal64.exe"

That makes a virtualenv, installs the dependencies, writes this worker's
`.env` with an ACL only Administrators can read, checks the backend actually
accepts the token, and registers a scheduled task that restarts on failure.
Run it once per worker with a different `-WorkerId` and `-TerminalPath`.

It deliberately does not install MetaTrader — that installer is interactive
and each worker needs its own copy. The rest of this section is what the
script automates, and what to do by hand if you would rather.

Per terminal, one isolated installation. **Two workers must never share a
terminal directory** — MetaTrader keeps per-installation state, and a second
process logging in underneath the first is how sessions get crossed.

    C:\MT5\terminal1\terminal64.exe
    C:\MT5\terminal2\terminal64.exe
    ...

Install the worker once:

    pip install -r worker\requirements.txt

Then one `.env` per worker, copied from `worker\.env.example`:

    FXJP_API_URL=https://www.fxjournalpro.com/api/mt5
    FXJP_WORKER_TOKEN=<the backend's MT5_WORKER_TOKEN>
    FXJP_WORKER_ID=vps1-terminal1
    MT5_TERMINAL_PATH=C:\MT5\terminal1\terminal64.exe

Run it:

    python worker\mt5_worker.py

Start with **one** worker and one test account. Once Connect → Fetch → Import →
Disconnect is reliable, start more processes — each with its own
`FXJP_WORKER_ID` and `MT5_TERMINAL_PATH`. Nothing else changes: the queue
already hands one job to one worker, and extra jobs wait.

For production, run each worker under NSSM or a Scheduled Task set to restart
on failure, so a crash or a VPS reboot brings it back. `setup-windows.ps1`
registers that task for you.

The task triggers **at logon, not at startup**, and that is not an oversight:
MetaTrader 5 is a desktop application and needs an interactive session. A task
running as SYSTEM lands in session 0 with no desktop and the terminal never
comes up. Set the VPS to log its user in automatically, and the workers start
with the session.

## Backend configuration

    MT5_VPS_SYNC_ENABLED=true
    MT5_WORKER_TOKEN=<64+ random characters>
    MT5_CREDENTIAL_MASTER_KEY=<64 hex characters>
    MT5_CLOUD_BACKFILL_DAYS=90

Without the first two, `/api/mt5/vps/connect` answers `503 VPS_NOT_CONFIGURED`
and the status endpoint reports `vpsSyncAvailable: false`, so the UI can offer
the EA method instead of a form that would queue a job nobody will pick up.

`MT5_CREDENTIAL_MASTER_KEY` is what the investor passwords are encrypted
under. Losing it means every customer has to reconnect; leaking it means every
stored password is readable. It is not interchangeable with the worker token.

## The security of it

The investor password is stored under AES-256-GCM with a per-record data key,
itself wrapped with the master key. It is decrypted only in
`/api/mt5/worker/claim`, only for a job that has just been claimed, and handed
to that worker over HTTPS. The worker holds it in memory for one job and never
writes it to disk or to a log.

**`MT5_WORKER_TOKEN` can pull any connected customer's investor password.**
That follows from the design — a terminal has to log in — but it means the
token is a high-value secret. Treat it like a database password, give each VPS
its own if you ever run more than one, and rotate it if a VPS is reimaged or a
worker machine is ever shared.

The worker API also refuses plaintext HTTP in production, so a
misconfigured `FXJP_API_URL` cannot put a password on the wire in the clear.

The customer-facing routes never return the password or its ciphertext:
`/api/accounts` strips `investorPasswordEnc` and the EA token from every
account before it reaches a browser, sending `hasStoredCredentials` instead.

### The worker cannot trade

`mt5_worker.py` imports no order function and calls none. Beyond that, it
refuses the job outright when MetaTrader reports the session as trade-enabled:

    if getattr(info, "trade_allowed", False):
        raise SyncFailed("This looks like a master password, not the read-only
                          investor password...", "NOT_INVESTOR_PASSWORD")

An investor login is read-only, so `trade_allowed` is false. A true there means
a master password was stored by mistake, and the worker must not hold a
credential that can move a customer's money even if it would never use it. The
customer is told to re-enter their investor password.

## Failures

Jobs are **leased**, not just assigned. A worker holds a job for five minutes
and extends that with a heartbeat while a long history is pulling. If the
process is killed, the VPS reboots or the terminal hangs, the lease expires and
the job goes back to the queue — reaped on the next claim, so this needs no
background process either. Three attempts, then the job is failed and the
customer sees the error.

A job belongs to one worker. Another worker sending a sync or a heartbeat for
it gets `409 JOB_LEASE_LOST` and is expected to stop and re-claim, which is
what stops a resumed worker from writing over the one that took over from it.

A failed sync **keeps what it already imported**. Batches are applied as they
arrive and the cursor moves with them, so a retry resumes rather than starting
over, and a customer never loses trades because attempt two failed.

| Error code | Means |
| --- | --- |
| `MT5_LOGIN_FAILED` | Wrong login, server or password, or the broker rejected the session. |
| `NOT_INVESTOR_PASSWORD` | A master password was stored. Ask for the investor one. |
| `MT5_WRONG_LOGIN` | The terminal was on another account — a session was not cleaned. Investigate before trusting that worker. |
| `MT5_HISTORY_FAILED` | Terminal reachable, history read failed. Usually transient. |
| `WORKER_AUTH_FAILED` | `FXJP_WORKER_TOKEN` does not match the backend. |
| `VPS_NOT_CONFIGURED` | `MT5_VPS_SYNC_ENABLED` / `MT5_WORKER_TOKEN` not set on the backend. |

## Testing

`tests/mt5-vps.test.mjs` covers the backend half — 49 checks: worker
authentication, that a customer session cannot claim jobs, the credential round
trip, lease ownership, deals becoming trades with the right direction, replay
deduplication, the incremental cursor, and a failure keeping its imported
trades.

    $env:MT5_VPS_SYNC_ENABLED="true"; $env:MT5_WORKER_TOKEN="dev-worker-token"; npm run dev
    node --env-file-if-exists=.env tests/mt5-vps.test.mjs

What that cannot cover is MetaTrader itself: whether the terminal logs in,
whether `history_deals_get` returns what the broker holds, and whether a
session really is clean for the next job. Those need the VPS, one terminal and
one real test account — which is why the first milestone is exactly that.
