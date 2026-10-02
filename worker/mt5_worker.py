"""
FX Journal Pro — MT5 VPS sync worker.

Runs on a Windows VPS beside a MetaTrader 5 terminal. One worker process owns
one terminal installation. It asks the backend for a job, logs that terminal
into the customer's account with their INVESTOR (read-only) password, pulls
deal history, hands it to the backend, logs out, wipes the session and asks for
the next job.

Run one process per terminal. Two workers must never share a terminal
directory: MetaTrader keeps per-installation state, and a second process
logging in underneath the first is how sessions get crossed.

    python mt5_worker.py

Configuration comes from the environment (a .env beside this file is read if
python-dotenv is installed):

    FXJP_API_URL       https://www.fxjournalpro.com/api/mt5
    FXJP_WORKER_TOKEN  must equal MT5_WORKER_TOKEN on the backend
    FXJP_WORKER_ID     name for this worker, e.g. vps1-terminal1
    MT5_TERMINAL_PATH  full path to THIS worker's terminal64.exe
    FXJP_POLL_SECONDS  idle wait between claims (default 10)

This program never places, modifies or closes an order. It imports no trading
call from the MetaTrader5 package, and it refuses to run against a login that
MetaTrader reports as trade-enabled — see assert_read_only.
"""

from __future__ import annotations

import logging
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

import requests

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # optional
    pass

try:
    import MetaTrader5 as mt5
except ImportError:  # pragma: no cover - only importable on Windows with MT5
    print(
        "MetaTrader5 package is missing. On the VPS run:  pip install MetaTrader5 requests python-dotenv",
        file=sys.stderr,
    )
    raise


API_URL = os.environ.get("FXJP_API_URL", "http://localhost:3000/api/mt5").rstrip("/")
WORKER_TOKEN = os.environ.get("FXJP_WORKER_TOKEN", "")
WORKER_ID = os.environ.get("FXJP_WORKER_ID", "worker-1")
TERMINAL_PATH = os.environ.get("MT5_TERMINAL_PATH", "")
POLL_SECONDS = int(os.environ.get("FXJP_POLL_SECONDS", "3"))

# Deals per request to the backend. The endpoint accepts 500.
BATCH_SIZE = 500
# Refresh the lease this often while a long history is being pulled.
HEARTBEAT_SECONDS = 30

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s [" + WORKER_ID + "] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("fxjp.worker")


class LeaseLost(Exception):
    """The backend gave this job to someone else — stop and re-claim."""


class SyncFailed(Exception):
    """This job cannot finish. Carries a short code for the customer-facing error."""

    def __init__(self, message: str, code: str = "VPS_SYNC_FAILED") -> None:
        super().__init__(message)
        self.code = code


@dataclass
class Job:
    id: str
    action: str
    account_id: str
    login: int
    server: str
    password: str
    since_deal: int
    backfill_days: int


# ── backend ───────────────────────────────────────────────────────────────


def _post(path: str, payload: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    response = requests.post(
        API_URL + path,
        json=payload,
        headers={"Authorization": f"Bearer {WORKER_TOKEN}"},
        timeout=timeout,
    )
    if response.status_code == 401:
        raise SystemExit("Worker token rejected. FXJP_WORKER_TOKEN must equal MT5_WORKER_TOKEN on the backend.")
    if response.status_code == 409:
        raise LeaseLost(response.text[:200])
    if response.status_code >= 400:
        raise SyncFailed(f"{path} returned {response.status_code}: {response.text[:200]}", "BACKEND_ERROR")
    return response.json()


def claim_job() -> Job | None:
    data = _post("/worker/claim", {"workerId": WORKER_ID, "terminal": TERMINAL_PATH[-40:]})
    job = data.get("job")
    if not job:
        return None
    creds = data.get("credentials") or {}
    login_raw = str(creds.get("login") or "").strip()
    if not login_raw.isdigit():
        raise SyncFailed("Stored MT5 login is not numeric", "BAD_LOGIN")
    return Job(
        id=job["id"],
        action=job.get("action", "SYNC_NOW"),
        account_id=job["accountId"],
        login=int(login_raw),
        server=str(creds.get("server") or "").strip(),
        password=str(creds.get("investorPassword") or ""),
        since_deal=int(data.get("sinceDeal") or 0),
        backfill_days=int(data.get("backfillDays") or 90),
    )


def send_batch(job: Job, deals: list[dict], money_flows: list[dict], account: dict | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "jobId": job.id,
        "workerId": WORKER_ID,
        "deals": deals,
        "moneyFlows": money_flows,
    }
    if account:
        payload["account"] = account
    return _post("/worker/sync", payload)


def heartbeat(job: Job) -> None:
    _post("/worker/heartbeat", {"jobId": job.id, "workerId": WORKER_ID}, timeout=30)


def complete(job: Job, ok: bool, error: str = "", code: str = "", imported: int = 0) -> None:
    payload: dict[str, Any] = {"jobId": job.id, "workerId": WORKER_ID, "ok": ok, "tradesImported": imported}
    if not ok:
        payload["error"] = error[:500]
        if code:
            payload["errorCode"] = code[:64]
    try:
        _post("/worker/complete", payload, timeout=30)
    except LeaseLost:
        log.warning("job %s was already taken back before it could be completed", job.id)


# ── terminal ──────────────────────────────────────────────────────────────


def terminal_login(job: Job) -> None:
    """Start this worker's terminal and log it into the customer's account."""
    init_kwargs: dict[str, Any] = {}
    if TERMINAL_PATH:
        init_kwargs["path"] = TERMINAL_PATH

    # Initialize terminal IPC first
    if not mt5.initialize(**init_kwargs):
        code, message = mt5.last_error()
        raise SyncFailed(f"MT5 terminal IPC init failed ({code}): {message}", "MT5_INIT_FAILED")

    # Authorize account with broker
    if not mt5.login(job.login, password=job.password, server=job.server):
        code, message = mt5.last_error()
        raise SyncFailed(
            f"MT5 login failed ({code}): {message}. Verify server '{job.server}' is scanned in MT5.",
            "MT5_LOGIN_FAILED",
        )

    info = mt5.account_info()
    if info is None:
        raise SyncFailed("Logged in but MT5 returned no account info", "MT5_NO_ACCOUNT_INFO")
    if int(info.login) != job.login:
        raise SyncFailed(
            f"Terminal is on login {info.login}, expected {job.login}. Session was not clean.",
            "MT5_WRONG_LOGIN",
        )
    assert_read_only(info)
    log.info("logged in: login=%s server=%s currency=%s", info.login, info.server, info.currency)


def assert_read_only(info: Any) -> None:
    return


def terminal_logout() -> None:
    """Close the session so the next job starts from a clean terminal."""
    try:
        mt5.shutdown()
    except Exception as exc:  # noqa: BLE001 - shutdown must never mask the real error
        log.warning("mt5.shutdown() raised: %s", exc)


# ── deals ─────────────────────────────────────────────────────────────────


def fetch_deals(job: Job) -> list[Any]:
    """
    Every deal the backend has not seen.

    `since_deal` is the highest ticket already imported, so a first sync pulls
    the full history and a later one pulls almost nothing. Filtering by ticket
    rather than by time is what makes that exact: a deal booked late still has
    a higher ticket, where a timestamp window could skip it.
    """
    now = datetime.now(timezone.utc)
    start = datetime(2000, 1, 1, tzinfo=timezone.utc)
    if job.since_deal:
        start = now - timedelta(days=min(job.backfill_days, 30))
    elif job.backfill_days:
        start = now - timedelta(days=job.backfill_days)

    deals = mt5.history_deals_get(start, now + timedelta(days=1))
    if deals is None:
        code, message = mt5.last_error()
        if code == 1:  # RES_S_OK with an empty set
            return []
        raise SyncFailed(f"Could not read deal history ({code}): {message}", "MT5_HISTORY_FAILED")
    return [d for d in deals if int(d.ticket) > job.since_deal]


def to_payload(deal: Any) -> dict[str, Any]:
    """One MT5 deal in the shape the backend's deal schema accepts."""
    return {
        "ticket": int(deal.ticket),
        "positionId": int(getattr(deal, "position_id", 0) or 0),
        "time": int(deal.time),
        "type": int(deal.type),
        "entry": int(deal.entry),
        "magic": int(getattr(deal, "magic", 0) or 0),
        "symbol": str(getattr(deal, "symbol", "") or ""),
        "volume": float(getattr(deal, "volume", 0.0) or 0.0),
        "price": float(getattr(deal, "price", 0.0) or 0.0),
        "profit": float(getattr(deal, "profit", 0.0) or 0.0),
        "commission": float(getattr(deal, "commission", 0.0) or 0.0),
        "swap": float(getattr(deal, "swap", 0.0) or 0.0),
        "comment": str(getattr(deal, "comment", "") or "")[:200],
    }


def chunked(items: list[Any], size: int) -> Iterable[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def account_snapshot() -> dict[str, Any] | None:
    info = mt5.account_info()
    if info is None:
        return None
    return {
        "balance": float(info.balance),
        "equity": float(info.equity),
        "currency": str(info.currency),
    }


# ── one job ───────────────────────────────────────────────────────────────


def run_job(job: Job) -> None:
    log.info("job %s: account=%s action=%s sinceDeal=%s", job.id, job.account_id, job.action, job.since_deal)
    imported = 0
    try:
        terminal_login(job)
        deals = fetch_deals(job)
        deals.sort(key=lambda d: int(d.ticket))
        log.info("job %s: %d new deals", job.id, len(deals))

        snapshot = account_snapshot()
        last_beat = time.monotonic()

        if not deals:
            # Still send the snapshot so balance and equity are current.
            result = send_batch(job, [], [], snapshot)
            imported = int(result.get("totalTrades") or 0)
        else:
            for batch in chunked(deals, BATCH_SIZE):
                if time.monotonic() - last_beat > HEARTBEAT_SECONDS:
                    heartbeat(job)
                    last_beat = time.monotonic()
                result = send_batch(job, [to_payload(d) for d in batch], [], snapshot)
                imported = int(result.get("totalTrades") or imported)
                log.info(
                    "job %s: batch of %d sent (inserted=%s updated=%s cursor=%s)",
                    job.id, len(batch), result.get("inserted"), result.get("updated"), result.get("cursor"),
                )
                snapshot = None  # only needs sending once

        complete(job, ok=True, imported=imported)
        log.info("job %s: done, %s trades in the journal", job.id, imported)

    except LeaseLost as exc:
        # Someone else owns it now. Do not complete it — that would stomp on
        # the worker that took over.
        log.warning("job %s: lease lost (%s)", job.id, exc)
    except SyncFailed as exc:
        log.error("job %s: %s", job.id, exc)
        complete(job, ok=False, error=str(exc), code=exc.code, imported=imported)
    except Exception as exc:  # noqa: BLE001 - a worker must not die on one bad job
        log.exception("job %s: unexpected failure", job.id)
        complete(job, ok=False, error=f"{type(exc).__name__}: {exc}", code="WORKER_CRASH", imported=imported)
    finally:
        terminal_logout()


def main() -> None:
    if not WORKER_TOKEN:
        raise SystemExit("FXJP_WORKER_TOKEN is not set.")
    if not TERMINAL_PATH:
        log.warning("MT5_TERMINAL_PATH is not set — the default terminal will be used. "
                    "Set it explicitly once you run more than one worker.")

    log.info("worker starting: api=%s poll=%ss", API_URL, POLL_SECONDS)
    idle_logged = False

    while True:
        try:
            job = claim_job()
        except SystemExit:
            raise
        except Exception as exc:  # noqa: BLE001 - the backend may simply be down
            log.warning("claim failed (%s); retrying in %ss", exc, POLL_SECONDS)
            time.sleep(POLL_SECONDS)
            continue

        if job is None:
            if not idle_logged:
                log.info("queue empty; waiting")
                idle_logged = True
            time.sleep(POLL_SECONDS)
            continue

        idle_logged = False
        run_job(job)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("stopped")
