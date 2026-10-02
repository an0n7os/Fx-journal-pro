# MT5 Integration Kit (Complete Standalone Module)

ഈ മോഡ്യൂൾ ഉപയോഗിച്ച് ഏത് പുതിയ പ്രോജക്റ്റിലേക്കും (Node.js, Express, React, PostgreSQL/Supabase) വളരെ എളുപ്പത്തിൽ **MetaTrader 5 (MT5)** കണക്റ്റിവിറ്റി ചേർക്കാൻ സാധിക്കും.

ഇതിൽ 2 പ്രധാന രീതിയിലുള്ള സിൻക്രൊണൈസേഷൻ അടങ്ങിയിരിക്കുന്നു:
1. **Custom Expert Advisor (EA - MQL5):** യൂസർ MT5 ടെർമിനലിൽ ഇൻസ്റ്റാൾ ചെയ്യുന്ന EA വഴി തത്സമയം (Real-time) ട്രേഡുകളും ബാലൻസും സിങ്ക് ചെയ്യുന്നു.
2. **Local Python Worker (Bridge):** യൂസറുടെ മെഷീനിൽ റൺ ചെയ്യുന്ന പൈത്തൺ സ്ക്രിപ്റ്റ് വഴി Investor Password ഉപയോഗിച്ച് ഹിസ്റ്ററി എടുക്കുന്നു.

---

## 📁 ഫോൾഡർ സ്ട്രക്ചർ (Folder Structure)

```text
mt5-integration-kit/
├── database/
│   └── mt5_complete_schema.sql    # PostgreSQL / Supabase ടേബിളുകൾ
├── backend/
│   ├── mt5Router.ts               # Express API റൂട്ടുകൾ (/api/mt5/...)
│   ├── mt5Service.ts              # HMAC സിഗ്നേച്ചർ, ട്രേഡ് കാൽക്കുലേഷൻ ലോജിക്
│   ├── eaTemplate.ts              # ഡൈനാമിക് MQL5 EA ജനറേറ്റർ ടെംപ്ലേറ്റ്
│   └── types.ts                   # Backend ടൈപ്പുകൾ
├── python_worker/
│   ├── worker.py                  # Windows desktop MT5 bridge worker
│   ├── requirements.txt           # Python ലൈബ്രറികൾ
│   └── README.md
├── frontend/
│   ├── MT5Automation.tsx          # റിയാക്റ്റ് ഫ്രണ്ട്-എൻഡ് UI കോംപോണന്റ്
│   └── types.ts                   # Frontend TypeScript interfaces
└── README.md                      # പൂർണ്ണമായ ഗൈഡ്
```

---

## 🚀 പുതിയ പ്രോജക്റ്റിലേക്ക് ചേർക്കാനുള്ള ഘട്ടങ്ങൾ (Step-by-Step)

### ഘട്ടം 1: ഡാറ്റാബേസ് സെറ്റപ്പ് (Database Setup)
1. നിങ്ങളുടെ PostgreSQL അല്ലെങ്കിൽ Supabase SQL Editor തുറക്കുക.
2. `database/mt5_complete_schema.sql` ഫയലിലെ SQL ക്വറികൾ റൺ ചെയ്യുക.
3. ഇത് ആവശ്യമായ താഴെ പറയുന്ന ടേബിളുകൾ നിർമ്മിക്കും:
   - `mt5_connections` (ബ്രോക്കർ & ഇൻവെസ്റ്റർ വിവരങ്ങൾ)
   - `mt5_sync_jobs` (വർക്കർ ജോബ് ക്യൂ)
   - `mt5_account_snapshots` (ഇക്വിറ്റി/ബാലൻസ് സ്നാപ്പ്ഷോട്ടുകൾ)
   - `mt5_open_positions` (ലൈവ് പൊസിഷനുകൾ)
   - `mt5_pending_orders` (പെൻഡിങ് ഓർഡറുകൾ)

---

### ഘട്ടം 2: ബാക്കെൻഡ് ഇന്റഗ്രേഷൻ (Backend Setup)
1. നിങ്ങളുടെ Node.js പ്രോജക്റ്റിലേക്ക് `backend/` ഫോൾഡറിലെ ഫയലുകൾ കോപ്പി ചെയ്യുക.
2. Express സെർവറിൽ `mt5Router` മൗണ്ട് ചെയ്യുക:

```typescript
import express from 'express';
import { createMt5Router } from './mt5-integration-kit/backend/mt5Router';

const app = express();

// Capture rawBody for HMAC verification (CRITICAL)
app.use(express.json({
  limit: '15mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

// Mount MT5 Router
const mt5Router = createMt5Router({
  getAccount: async (id) => { /* Fetch account from DB */ },
  saveAccount: async (acc) => { /* Update account in DB */ },
  saveSnapshots: async (snaps) => { /* Insert snapshots */ },
  saveOpenPositions: async (accId, pos) => { /* Replace open positions */ },
  savePendingOrders: async (accId, orders) => { /* Replace orders */ },
  saveTrades: async (trades) => { /* Insert/Upsert reconstructed trades */ },
  getQueuedJobs: async () => { /* Select * from mt5_sync_jobs where status='QUEUED' */ },
  updateJobStatus: async (jobId, status, err) => { /* Update job */ },
  saveImportedTrades: async (jobId, payload) => { /* Save worker trades */ },
  // No literal fallback. This token pulls a customer's decrypted investor
  // password, so a default in source means publishing it. The router answers
  // 503 BRIDGE_NOT_CONFIGURED when it is unset.
  bridgeAuthToken: process.env.BRIDGE_AUTH_TOKEN || ''
});

// Mount AFTER your own /api/mt5 routes, not before. Express matches in
// registration order, so mounting first shadows anything you already serve
// under that prefix.
app.use('/api/mt5', mt5Router);
```

> **This repository's own wiring lives in `server.ts`**, below `queueDepth()`.
> It mounts this router after the existing `/api/mt5/*` handlers, so the kit
> contributes only `/worker/jobs`, `/worker/job/:id/status` and
> `/worker/job/:id/trades` — the protocol `python_worker/worker.py` speaks.
> The EA endpoints in this router are never reached; `server.ts` answers those
> with HMAC verification on every route, zod-validated bodies and rate
> limiting.

---

### ഘട്ടം 3: ഫ്രണ്ട്-എൻഡ് ഇന്റഗ്രേഷൻ (Frontend Setup)
1. `frontend/MT5Automation.tsx` നിങ്ങളുടെ കോംപോണന്റ് ഫോൾഡറിലേക്ക് കോപ്പി ചെയ്യുക.
2. ആവശ്യമായ പാക്കേജുകൾ ഉണ്ടെന്ന് ഉറപ്പാക്കുക:
   ```bash
   npm install lucide-react recharts
   ```
3. നിങ്ങളുടെ അക്കൗണ്ട് പേജിലോ ഡാഷ്‌ബോർഡിലോ കോംപോണന്റ് റെൻഡർ ചെയ്യുക:

```tsx
import MT5Automation from './components/MT5Automation';

<MT5Automation 
  account={currentAccount} 
  authFetch={customAuthFetch} 
  onRefresh={() => refreshData()} 
/>
```

---

### ഘട്ടം 4: പൈത്തൺ വർക്കർ പ്രവർത്തിപ്പിക്കൽ (Python Worker - Optional for Bridge)
യൂസറുടെ കമ്പ്യൂട്ടറിലെ MT5-ൽ നിന്ന് നേരിട്ട് Investor Password വെച്ച് സിങ്ക് ചെയ്യാൻ:
1. `python_worker/` ഫോൾഡർ തുറക്കുക.
2. ഡിപ്പൻഡൻസികൾ ഇൻസ്റ്റാൾ ചെയ്യുക:
   ```bash
   pip install -r requirements.txt
   ```
3. എൻവയോൺമെന്റ് വേരിയബിളുകൾ സെറ്റ് ചെയ്യുക (വേണമെങ്കിൽ):
   ```bash
   set FXJOURNALPRO_API_URL=https://your-domain.com/api/mt5/worker
   set BRIDGE_AUTH_TOKEN=your-secret-token
   set MT5_PATH=C:\Program Files\MetaTrader 5\terminal64.exe
   ```
4. വർക്കർ റൺ ചെയ്യുക:
   ```bash
   python worker.py
   ```

---

## 🔒 സുരക്ഷാ സവിശേഷതകൾ (Security Features)
- **HMAC-SHA256 Signatures:** EA-യും സെർവറും തമ്മിലുള്ള എല്ലാ ആശയവിനിമയങ്ങളും ഒപ്പിട്ട് സുരക്ഷിതമാക്കിയിരിക്കുന്നു.
- **Replay Protection:** പഴയ റിക്വസ്റ്റുകൾ വീണ്ടും അയക്കുന്നത് തടയാൻ 5 മിനിറ്റ് ടൈംസ്റ്റാമ്പ് വിൻഡോ ഉണ്ട്.
- **Read-Only:** EA-യിലോ പൈത്തൺ സ്ക്രിപ്റ്റിലോ യാതൊരു ട്രേഡിങ് അല്ലെങ്കിൽ ഓർഡർ പ്ലേസ്മെന്റ് ഫംഗ്ഷനുകളും അടങ്ങിയിട്ടില്ല.
