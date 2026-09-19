import React, { useState, useCallback } from 'react';
import { Calculator, Target, ChevronDown, RefreshCw, Info, Lightbulb } from 'lucide-react';

// --- Shared instrument data ---
const INSTRUMENTS: Record<string, { pipSize: number; label: string }> = {
  'EURUSD': { pipSize: 0.0001, label: 'EUR/USD' },
  'GBPUSD': { pipSize: 0.0001, label: 'GBP/USD' },
  'AUDUSD': { pipSize: 0.0001, label: 'AUD/USD' },
  'NZDUSD': { pipSize: 0.0001, label: 'NZD/USD' },
  'USDCAD': { pipSize: 0.0001, label: 'USD/CAD' },
  'USDCHF': { pipSize: 0.0001, label: 'USD/CHF' },
  'USDJPY': { pipSize: 0.01,   label: 'USD/JPY' },
  'EURJPY': { pipSize: 0.01,   label: 'EUR/JPY' },
  'GBPJPY': { pipSize: 0.01,   label: 'GBP/JPY' },
  'AUDJPY': { pipSize: 0.01,   label: 'AUD/JPY' },
  'EURGBP': { pipSize: 0.0001, label: 'EUR/GBP' },
  'EURCHF': { pipSize: 0.0001, label: 'EUR/CHF' },
  'EURAUD': { pipSize: 0.0001, label: 'EUR/AUD' },
  'GBPAUD': { pipSize: 0.0001, label: 'GBP/AUD' },
  'GBPCAD': { pipSize: 0.0001, label: 'GBP/CAD' },
  'XAUUSD': { pipSize: 0.01,   label: 'XAU/USD (Gold)' },
  'XAGUSD': { pipSize: 0.001,  label: 'XAG/USD (Silver)' },
  'US30':   { pipSize: 1,      label: 'US30 (Dow Jones)' },
  'NAS100': { pipSize: 0.01,   label: 'NAS100 (Nasdaq)' },
  'SP500':  { pipSize: 0.01,   label: 'S&P 500' },
  'BTCUSD': { pipSize: 0.01,   label: 'BTC/USD' },
  'ETHUSD': { pipSize: 0.01,   label: 'ETH/USD' },
  'CUSTOM': { pipSize: 0.0001, label: 'Custom Pair' },
};

const JPY_PAIRS = ['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY'];
const INDEX_PAIRS = ['US30', 'NAS100', 'SP500'];
const COMMODITY_PAIRS = ['XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD'];

function getPipValuePerStdLot(pair: string, pipSize: number): number {
  if (JPY_PAIRS.includes(pair)) return (pipSize * 100_000) / 110;
  if (INDEX_PAIRS.includes(pair)) return pipSize;
  if (COMMODITY_PAIRS.includes(pair)) return pipSize * 100;
  return pipSize * 100_000;
}

// --- Shared styled input ---
const inputCls = (ring: string) =>
  `w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-slate-100 text-xs font-medium rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 ${ring} transition`;

const selectCls = (ring: string) =>
  `w-full appearance-none bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-slate-100 text-xs font-medium rounded-xl px-3 py-2.5 pr-8 focus:outline-none focus:ring-2 ${ring} transition cursor-pointer`;

// --- Instrument selector ---
function InstrumentSelect({ value, onChange, ring }: { value: string; onChange: (v: string) => void; ring: string }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} className={selectCls(ring)}>
        {Object.entries(INSTRUMENTS).map(([key, { label }]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
    </div>
  );
}

// ─── Pip Calculator ──────────────────────────────────────────────────────────
function PipCalculator() {
  const [pair, setPair] = useState('EURUSD');
  const [lotSize, setLotSize] = useState('1.00');
  const [pips, setPips] = useState('10');
  const [accountCurrency, setAccountCurrency] = useState('USD');
  const [customPipSize, setCustomPipSize] = useState('0.0001');
  const [result, setResult] = useState<{ pipValue: number; total: number } | null>(null);
  const [tooltip, setTooltip] = useState(false);

  const handleCalculate = useCallback(() => {
    const lots = parseFloat(lotSize);
    const pipCount = parseFloat(pips);
    const pip = pair === 'CUSTOM' ? parseFloat(customPipSize) : INSTRUMENTS[pair]?.pipSize ?? 0.0001;
    if (isNaN(lots) || isNaN(pipCount) || lots <= 0 || pipCount <= 0) return;
    const pipValuePerStdLot = getPipValuePerStdLot(pair, pip);
    const pipValuePerLot = pipValuePerStdLot * lots;
    const totalValue = pipValuePerLot * pipCount;
    setResult({ pipValue: pipValuePerLot, total: totalValue });
  }, [pair, lotSize, pips, customPipSize]);

  const handleReset = () => { setPair('EURUSD'); setLotSize('1.00'); setPips('10'); setResult(null); };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-100 dark:border-white/10 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <Calculator className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h2 className="dx-section-title">Pip Calculator</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Calculate pip value and P&L</p>
          </div>
        </div>
        <div className="relative">
          <button onMouseEnter={() => setTooltip(true)} onMouseLeave={() => setTooltip(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <Info className="h-4 w-4" />
          </button>
          {tooltip && (
            <div className="absolute right-0 top-8 w-64 bg-slate-900 text-white text-xs rounded-xl p-3 shadow-xl z-10 leading-relaxed">
              Pip value uses standard lot (100,000 units). JPY pairs use ~110 rate. Index and commodity pips may vary by broker.
            </div>
          )}
        </div>
      </div>
      <div className="p-6 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Currency Pair</label>
          <InstrumentSelect value={pair} onChange={setPair} ring="focus:ring-violet-500/40" />
        </div>
        {pair === 'CUSTOM' && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Pip Size</label>
            <input type="number" step="0.00001" value={customPipSize} onChange={e => setCustomPipSize(e.target.value)}
              className={inputCls('focus:ring-violet-500/40')} placeholder="e.g. 0.0001" />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Lot Size</label>
            <input type="number" step="0.01" min="0.01" value={lotSize} onChange={e => setLotSize(e.target.value)}
              className={inputCls('focus:ring-violet-500/40')} placeholder="1.00" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Number of Pips</label>
            <input type="number" step="1" min="1" value={pips} onChange={e => setPips(e.target.value)}
              className={inputCls('focus:ring-violet-500/40')} placeholder="10" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Account Currency</label>
          <div className="relative">
            <select value={accountCurrency} onChange={e => setAccountCurrency(e.target.value)}
              className={selectCls('focus:ring-violet-500/40')}>
              {['USD','EUR','GBP','JPY','AUD','CAD','CHF'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={handleCalculate}
            className="flex-1 bg-violet-600 hover:bg-violet-700 text-white font-semibold text-xs rounded-xl py-2.5 px-4 transition shadow-sm flex items-center justify-center gap-1.5">
            <Calculator className="h-3.5 w-3.5" /> Calculate
          </button>
          <button onClick={handleReset} title="Reset"
            className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 font-semibold text-xs rounded-xl py-2.5 px-3 transition">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        {result !== null && (
          <div className="mt-2 bg-violet-50 dark:bg-violet-900/20 border border-violet-200/60 dark:border-violet-700/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Pip Value (per lot)</span>
              <span className="text-sm font-bold text-violet-700 dark:text-violet-300 font-mono">
                {accountCurrency} {result.pipValue.toFixed(4)}
              </span>
            </div>
            <div className="h-px bg-violet-200/50 dark:bg-violet-700/30" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Total P&L for {pips} pips</span>
              <span className="text-base font-extrabold text-violet-700 dark:text-violet-300 font-mono">
                {accountCurrency} {result.total.toFixed(2)}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
              * Based on a standard lot of 100,000 units. Approximate values — broker rates may differ.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Position Size Calculator ─────────────────────────────────────────────────
type SlMode = 'percentage' | 'amount';

function PositionSizeCalculator() {
  const [accountBalance, setAccountBalance] = useState('10000');
  const [slMode, setSlMode] = useState<SlMode>('percentage');
  // percentage mode
  const [riskPercent, setRiskPercent] = useState('1');
  // amount mode
  const [riskAmount, setRiskAmount] = useState('100');
  // shared
  const [stopLossPips, setStopLossPips] = useState('20');
  const [pair, setPair] = useState('EURUSD');
  const [customPipSize, setCustomPipSize] = useState('0.0001');
  const [result, setResult] = useState<{ riskAmt: number; riskPct: number; lotSize: number; units: number; pipValue: number } | null>(null);

  const handleCalculate = useCallback(() => {
    const balance = parseFloat(accountBalance);
    const slPips = parseFloat(stopLossPips);
    const pip = pair === 'CUSTOM' ? parseFloat(customPipSize) : INSTRUMENTS[pair]?.pipSize ?? 0.0001;
    if (isNaN(balance) || isNaN(slPips) || balance <= 0 || slPips <= 0) return;

    let computedRiskAmt: number;
    if (slMode === 'percentage') {
      const risk = parseFloat(riskPercent);
      if (isNaN(risk) || risk <= 0) return;
      computedRiskAmt = (balance * risk) / 100;
    } else {
      const amt = parseFloat(riskAmount);
      if (isNaN(amt) || amt <= 0) return;
      computedRiskAmt = amt;
    }

    const pipValuePerStdLot = getPipValuePerStdLot(pair, pip);
    const lots = computedRiskAmt / (pipValuePerStdLot * slPips);
    const units = lots * 100_000;
    const pct = (computedRiskAmt / balance) * 100;
    setResult({ riskAmt: computedRiskAmt, riskPct: pct, lotSize: lots, units, pipValue: pipValuePerStdLot * lots });
  }, [accountBalance, slMode, riskPercent, riskAmount, stopLossPips, pair, customPipSize]);

  const handleReset = () => {
    setAccountBalance('10000'); setRiskPercent('1'); setRiskAmount('100');
    setStopLossPips('20'); setPair('EURUSD'); setResult(null);
  };

  const riskPresets = ['0.5', '1', '1.5', '2', '3'];
  const amountPresets = ['50', '100', '200', '500'];

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-white/10 rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-5 border-b border-slate-100 dark:border-white/10 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-800">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <Target className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h2 className="dx-section-title">Position Size Calculator</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Compute optimal lot size from risk</p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* Account Balance */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Account Balance (USD)</label>
          <input type="number" step="100" min="1" value={accountBalance} onChange={e => setAccountBalance(e.target.value)}
            className={inputCls('focus:ring-emerald-500/40')} placeholder="e.g. 10000" />
        </div>

        {/* Stop Loss Mode Toggle */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Stop Loss Defined By</label>
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800/70 rounded-xl">
            <button
              onClick={() => { setSlMode('percentage'); setResult(null); }}
              className={`flex items-center justify-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg transition-all duration-200 ${
                slMode === 'percentage'
                  ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <span className="text-[11px]">%</span>
              Percentage
            </button>
            <button
              onClick={() => { setSlMode('amount'); setResult(null); }}
              className={`flex items-center justify-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg transition-all duration-200 ${
                slMode === 'amount'
                  ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <span className="text-[11px]">$</span>
              Amount
            </button>
          </div>
        </div>

        {/* Conditional Risk Input */}
        {slMode === 'percentage' ? (
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
              Risk Per Trade (% of balance)
            </label>
            <div className="flex gap-1.5 mb-2">
              {riskPresets.map(p => (
                <button key={p} onClick={() => setRiskPercent(p)}
                  className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition ${
                    riskPercent === p
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-emerald-400'
                  }`}>
                  {p}%
                </button>
              ))}
            </div>
            <div className="relative">
              <input type="number" step="0.1" min="0.01" max="100" value={riskPercent}
                onChange={e => setRiskPercent(e.target.value)}
                className={inputCls('focus:ring-emerald-500/40') + ' pr-8'} placeholder="1" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
            </div>
            {accountBalance && riskPercent && !isNaN(parseFloat(accountBalance)) && !isNaN(parseFloat(riskPercent)) && (
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mt-1.5 ml-0.5">
                = ${((parseFloat(accountBalance) * parseFloat(riskPercent)) / 100).toFixed(2)} at risk
              </p>
            )}
          </div>
        ) : (
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
              Max Loss Amount (USD)
            </label>
            <div className="flex gap-1.5 mb-2">
              {amountPresets.map(p => (
                <button key={p} onClick={() => setRiskAmount(p)}
                  className={`text-[10px] font-bold px-2 py-1 rounded-lg border transition ${
                    riskAmount === p
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10 hover:border-emerald-400'
                  }`}>
                  ${p}
                </button>
              ))}
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">$</span>
              <input type="number" step="1" min="1" value={riskAmount}
                onChange={e => setRiskAmount(e.target.value)}
                className={inputCls('focus:ring-emerald-500/40') + ' pl-7'} placeholder="100" />
            </div>
            {accountBalance && riskAmount && !isNaN(parseFloat(accountBalance)) && !isNaN(parseFloat(riskAmount)) && (
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium mt-1.5 ml-0.5">
                = {((parseFloat(riskAmount) / parseFloat(accountBalance)) * 100).toFixed(2)}% of balance
              </p>
            )}
          </div>
        )}

        {/* Stop Loss Pips */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Stop Loss (Pips)</label>
          <input type="number" step="1" min="1" value={stopLossPips} onChange={e => setStopLossPips(e.target.value)}
            className={inputCls('focus:ring-emerald-500/40')} placeholder="20" />
        </div>

        {/* Instrument */}
        <div>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Instrument</label>
          <InstrumentSelect value={pair} onChange={setPair} ring="focus:ring-emerald-500/40" />
        </div>
        {pair === 'CUSTOM' && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Pip Size</label>
            <input type="number" step="0.00001" value={customPipSize} onChange={e => setCustomPipSize(e.target.value)}
              className={inputCls('focus:ring-emerald-500/40')} placeholder="e.g. 0.0001" />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button onClick={handleCalculate}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl py-2.5 px-4 transition shadow-sm flex items-center justify-center gap-1.5">
            <Target className="h-3.5 w-3.5" /> Calculate
          </button>
          <button onClick={handleReset} title="Reset"
            className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 font-semibold text-xs rounded-xl py-2.5 px-3 transition">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Result */}
        {result !== null && (
          <div className="mt-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200/60 dark:border-emerald-700/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Amount at Risk</span>
              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300 font-mono">${result.riskAmt.toFixed(2)}</span>
            </div>
            <div className="h-px bg-emerald-200/50 dark:bg-emerald-700/30" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Recommended Lot Size</span>
              <span className="text-base font-extrabold text-emerald-700 dark:text-emerald-300 font-mono">{result.lotSize.toFixed(2)} lots</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Units</span>
              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300 font-mono">{Math.round(result.units).toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Pip Value (at this lot size)</span>
              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300 font-mono">${result.pipValue.toFixed(4)}</span>
            </div>
            <div className="flex gap-2 mt-1 flex-wrap">
              <span className="text-[10px] font-semibold px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 rounded-lg border border-emerald-200/60 dark:border-emerald-700/40">
                {result.riskPct.toFixed(2)}% Risk
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 rounded-lg border border-emerald-200/60 dark:border-emerald-700/40">
                ${result.riskAmt.toFixed(2)} Loss Cap
              </span>
              <span className="text-[10px] font-semibold px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-lg border border-slate-200/60 dark:border-white/10">
                {stopLossPips} pip SL
              </span>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
              * Approximate values based on standard lot (100,000 units). Adjust for broker specifications.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────
type Tool = 'pip' | 'position';

export default function TradingTools() {
  const [activeTool, setActiveTool] = useState<Tool>('pip');
  const tools: { id: Tool; label: string; icon: React.ReactNode; activeClass: string }[] = [
    { id: 'pip',      label: 'Pip Calculator',             icon: <Calculator className="h-4 w-4" />, activeClass: 'text-violet-700 dark:text-violet-300' },
    { id: 'position', label: 'Position Size Calculator',   icon: <Target className="h-4 w-4" />,     activeClass: 'text-emerald-700 dark:text-emerald-300' },
  ];

  return (
    <div className="space-y-6">
      {/* Tab Switcher */}
      <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-800/60 rounded-xl w-fit">
        {tools.map(tool => (
          <button key={tool.id} onClick={() => setActiveTool(tool.id)}
            className={`flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg transition-all duration-200 ${
              activeTool === tool.id
                ? `bg-white dark:bg-slate-900 ${tool.activeClass} shadow-sm`
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}>
            {tool.icon}
            {tool.label}
          </button>
        ))}
      </div>

      {/* Active Tool */}
      <div className="max-w-lg">
        {activeTool === 'pip' && <PipCalculator />}
        {activeTool === 'position' && <PositionSizeCalculator />}
      </div>

      {/* Educational Footer */}
      <div className="max-w-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-white/10 rounded-2xl p-4">
        <h3 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5"><Lightbulb className="h-3.5 w-3.5 text-violet-400" /> Trading Tips</h3>
        <ul className="space-y-1.5">
          {activeTool === 'pip' ? (
            <>
              <li className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">• A pip is the smallest price movement. For most pairs, 1 pip = 0.0001.</li>
              <li className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">• For JPY pairs (e.g. USD/JPY), 1 pip = 0.01 since the quote uses 2 decimal places.</li>
              <li className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">• A standard lot = 100,000 units. A mini lot = 10,000. A micro lot = 1,000 units.</li>
            </>
          ) : (
            <>
              <li className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">• Never risk more than 1–2% of your account on a single trade.</li>
              <li className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">• Your stop loss placement determines your position size — not the other way around.</li>
              <li className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">• Consistent position sizing is the foundation of long-term capital preservation.</li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
}