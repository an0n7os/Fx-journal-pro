import os
import time
import requests
import MetaTrader5 as mt5
from datetime import datetime, timezone
import json

# ====================================================================
# Configuration
# ====================================================================
API_URL = os.environ.get('FXJOURNALPRO_API_URL', 'http://localhost:3000/api/mt5/worker')
BRIDGE_ID = os.environ.get('BRIDGE_ID', 'worker-1')

# No default. This token pulls a customer's decrypted investor password, and a
# literal here would be published with the source — the server deliberately has
# no fallback either, so a default would only mean every request is rejected
# with no explanation of why.
BRIDGE_TOKEN = os.environ.get('BRIDGE_AUTH_TOKEN', '').strip()
if not BRIDGE_TOKEN:
    raise SystemExit(
        'BRIDGE_AUTH_TOKEN is not set.\n'
        '  Windows:  set BRIDGE_AUTH_TOKEN=<the same value as the server\'s MT5_WORKER_TOKEN>\n'
        'Without it every request to the server is rejected with 401.'
    )

# Path to your local MT5 Terminal executable
MT5_PATH = os.environ.get('MT5_PATH', r'C:\Program Files\MetaTrader 5\terminal64.exe')

headers = {
    'Authorization': f'Bearer {BRIDGE_TOKEN}',
    'X-Worker-Id': BRIDGE_ID,
    'Content-Type': 'application/json'
}

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def send_heartbeat():
    try:
        requests.post(f"{API_URL}/heartbeat", headers=headers, json={"status": "AVAILABLE"}, timeout=5)
    except Exception:
        pass

def fetch_jobs():
    try:
        r = requests.get(f"{API_URL}/jobs", headers=headers, timeout=10)
        if r.status_code == 200:
            return r.json().get('jobs', [])
    except Exception as e:
        log(f"Error fetching jobs: {e}")
    return []

def update_job(job_id, status, error_message=None):
    try:
        requests.post(f"{API_URL}/job/{job_id}/status", headers=headers, json={
            "status": status,
            "error_message": error_message
        }, timeout=10)
        log(f"  -> Job {job_id} status: {status}" + (f" ({error_message})" if error_message else ""))
    except Exception as e:
        log(f"Error updating job status: {e}")

# Force-killing terminals is OFF by default.
#
# `taskkill /F /IM terminal64.exe` kills EVERY MetaTrader 5 terminal on the
# machine, not a stale one this worker left behind. The README tells people to
# run this worker on their own computer, where that terminal is very likely the
# one they are trading on — killing it mid-position is not something a sync job
# gets to decide. Set MT5_KILL_TERMINALS=true only on a dedicated box that runs
# nothing else.
KILL_TERMINALS = os.environ.get('MT5_KILL_TERMINALS', '').strip().lower() == 'true'


def kill_mt5_processes():
    """Kill running MT5 terminal processes to avoid authorization conflicts."""
    if not KILL_TERMINALS:
        return
    import subprocess
    try:
        result = subprocess.run(
            ['taskkill', '/F', '/IM', 'terminal64.exe'],
            capture_output=True, text=True
        )
        if 'SUCCESS' in result.stdout:
            log("Killed existing MT5 terminal process(es)")
            time.sleep(2)
        else:
            log("No existing MT5 terminal processes found")
    except Exception as e:
        log(f"Could not kill MT5 processes: {e}")

def init_mt5():
    """Kill stale MT5 terminals (opt-in), then initialize."""
    kill_mt5_processes()

    if not os.path.exists(MT5_PATH):
        log(f"MT5 not found at: {MT5_PATH}. Please check MT5_PATH env var.")
        return False

    log(f"Launching fresh MT5 terminal at: {MT5_PATH}")
    if mt5.initialize(MT5_PATH):
        return True

    error = mt5.last_error()
    log(f"MT5 initialize failed: {error}")
    return False

def process_job(job):
    job_id = job['id']
    conn = job.get('connection') or {}
    account_number = conn.get('mt5AccountNumber')
    server = conn.get('mt5Server')
    
    log(f"===== Processing job {job_id} =====")
    log(f"Account: {account_number} | Server: {server}")
    update_job(job_id, 'CONNECTING')
    
    if not init_mt5():
        error = f"MT5 initialize() failed: {mt5.last_error()}"
        log(error)
        update_job(job_id, 'FAILED', error)
        return

    log(f"MT5 initialized. Version: {mt5.version()}")

    # Login with investor password (read-only)
    account_int = int(account_number)
    password = conn.get('investorPassword', '')
    
    log(f"Logging in to account {account_int} on {server}...")
    if not mt5.login(account_int, password=password, server=server):
        error = f"MT5 login failed: {mt5.last_error()}"
        log(error)
        update_job(job_id, 'FAILED', error)
        mt5.shutdown()
        return

    account_info = mt5.account_info()

    # Refuse an account this worker could trade on.
    #
    # MetaTrader reports trade_allowed False for an investor login. True here
    # means a MASTER password was stored instead of the investor one, and this
    # program must not hold a credential that can move a customer's money —
    # even though it never calls an order function. Logging in anyway is how a
    # read-only tool quietly ends up with trading rights.
    if getattr(account_info, 'trade_allowed', False):
        error = ("This looks like a master password, not the read-only investor password. "
                 "Ask the customer to re-enter their Investor password.")
        log(error)
        update_job(job_id, 'FAILED', error)
        mt5.shutdown()
        return

    log(f"Logged in! Balance: {account_info.balance} {account_info.currency}, Server: {account_info.server}")

    update_job(job_id, 'FETCHING_HISTORY')

    # Fetch ALL history from 2000 to now
    from_date = datetime(2000, 1, 1, tzinfo=timezone.utc)
    to_date = datetime.now(timezone.utc)
    history_deals = mt5.history_deals_get(from_date, to_date)

    if history_deals is None:
        error = f"Failed to get history deals: {mt5.last_error()}"
        log(error)
        update_job(job_id, 'FAILED', error)
        mt5.shutdown()
        return

    log(f"Fetched {len(history_deals)} raw deals from broker")

    # Reconstruct closed positions from deals
    positions = {}
    initial_balance = None
    for deal in history_deals:
        if deal.type == 2 and deal.profit > 0:  # DEAL_TYPE_BALANCE
            initial_balance = deal.profit
            break

    for deal in history_deals:
        pid = deal.position_id
        if not deal.symbol:
            continue

        if pid not in positions:
            positions[pid] = {
                'externalTradeId': str(pid),
                'symbol':          deal.symbol,
                'type':            'BUY' if deal.type == 0 else 'SELL',
                'lotSize':         0.0,
                'entryPrice':      0.0,
                'exitPrice':       0.0,
                'entryTime':       None,
                'exitTime':        None,
                'netProfit':       0.0,
                'commission':      0.0,
                'swap':            0.0,
                'isOpen':          True,
                'exitVolume':      0.0,
            }

        pos = positions[pid]

        if deal.entry == 0:   # IN (position opened)
            t = pos['lotSize'] + deal.volume
            pos['entryPrice'] = ((pos['entryPrice'] * pos['lotSize']) + (deal.price * deal.volume)) / t if t > 0 else deal.price
            pos['lotSize']     = t
            pos['entryTime']   = datetime.fromtimestamp(deal.time, tz=timezone.utc).isoformat()
            pos['commission'] += deal.commission
            pos['swap']       += deal.swap

        elif deal.entry == 1: # OUT (position closed)
            t = pos['exitVolume'] + deal.volume
            pos['exitPrice']  = ((pos['exitPrice'] * pos['exitVolume']) + (deal.price * deal.volume)) / t if t > 0 else deal.price
            pos['exitVolume'] = t
            pos['exitTime']   = datetime.fromtimestamp(deal.time, tz=timezone.utc).isoformat()
            pos['netProfit'] += deal.profit
            pos['commission']+= deal.commission
            pos['swap']      += deal.swap

            # Mark as closed when exit volume >= entry volume (allowing 1% tolerance)
            if pos['exitVolume'] >= pos['lotSize'] * 0.99:
                pos['isOpen'] = False

    # Only send fully closed trades
    closed_trades = [
        t for t in positions.values()
        if not t['isOpen'] and t['symbol'] and t['lotSize'] > 0 and t['exitTime']
    ]

    # Final profit = deal profit + commission + swap
    for t in closed_trades:
        t['netProfit'] = round(t['netProfit'] + t['commission'] + t['swap'], 2)
        t['entryPrice'] = round(t['entryPrice'], 5)
        t['exitPrice']  = round(t['exitPrice'], 5)
        t['lotSize']    = round(t['lotSize'], 2)
        del t['exitVolume']
        del t['isOpen']

    log(f"Reconstructed {len(closed_trades)} closed trades from {len(positions)} positions")

    mt5.shutdown()
    log("MT5 disconnected and credentials cleared")

    update_job(job_id, 'IMPORTING')

    payload = {
        "trades": closed_trades,
        "equity": account_info.equity,
        "balance": account_info.balance,
        "initial_balance": initial_balance
    }

    try:
        r = requests.post(
            f"{API_URL}/job/{job_id}/trades",
            headers=headers,
            json=payload,
            timeout=60
        )
        if r.status_code == 200:
            result = r.json()
            imported = result.get('imported', len(closed_trades))
            skipped  = result.get('skipped', 0)
            update_job(job_id, 'COMPLETED')
            log(f"SUCCESS! Imported {imported} trades, {skipped} duplicates skipped.")
        else:
            err = r.json().get('error', f'HTTP {r.status_code}')
            update_job(job_id, 'FAILED', f"Backend import failed: {err}")
    except Exception as e:
        update_job(job_id, 'FAILED', f"Network error during import: {e}")

def main():
    log("MT5 Bridge Worker started.")
    log(f"Polling: {API_URL}/jobs every 5s")
    log(f"MT5 Path: {MT5_PATH}")

    last_heartbeat = 0
    while True:
        now = time.time()
        if now - last_heartbeat > 30:
            send_heartbeat()
            last_heartbeat = now

        jobs = fetch_jobs()
        if jobs:
            log(f"Found {len(jobs)} pending job(s)")
            process_job(jobs[0])
        
        time.sleep(5)

if __name__ == '__main__':
    main()
