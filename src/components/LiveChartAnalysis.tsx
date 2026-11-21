import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  Image as ImageIcon,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  AlertTriangle,
  X,
  Target,
  ShieldAlert,
  ArrowRight,
  Maximize2,
  Clock,
  RefreshCw,
  Copy,
  Check,
  Zap,
  Layers,
  BarChart2,
  Sliders,
  HelpCircle,
  FileText
} from 'lucide-react';
import { User, TradingAccount } from '../types';
import ProFeaturePanel from './ProFeaturePanel';

interface LiveChartAnalysisProps {
  user: User;
  account: TradingAccount;
  onUpgradeToPro: () => void;
  onOpenTradeModal?: (prefill: any) => void;
}

export interface ChartAnalysisResult {
  recommendation: 'BUY' | 'SELL' | 'WAIT / NO TRADE';
  buyConfidence: number;
  sellConfidence: number;
  trend: 'Bullish' | 'Bearish' | 'Sideways' | string;
  supportLevels: string[];
  resistanceLevels: string[];
  suggestedEntry: string;
  suggestedStopLoss: string;
  suggestedTakeProfit: string;
  riskRewardRatio?: string;
  explanation: string;
  keyObservations: string[];
  timeframeDetected?: string;
  pairDetected?: string;
  timestamp?: string;
}

interface SavedChartAnalysis {
  id: string;
  timestamp: string;
  pair: string;
  timeframe: string;
  imageThumbnail: string;
  analysis: ChartAnalysisResult;
}

const COMMON_PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD', 'US30', 'NAS100', 'ETHUSD'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

export default function LiveChartAnalysis({
  user,
  account,
  onUpgradeToPro,
  onOpenTradeModal,
}: LiveChartAnalysisProps) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState('H1');
  const [traderNotes, setTraderNotes] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ChartAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SavedChartAnalysis[]>(() => {
    try {
      const stored = localStorage.getItem(`fx_chart_analyses_${user?.id || 'guest'}`);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showFullImageModal, setShowFullImageModal] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropZoneRef = useRef<HTMLDivElement | null>(null);

  // Global paste listener (Ctrl+V) so traders can paste directly from clipboard
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            handleImageSelected(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleImageSelected = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload a valid image file (PNG, JPG, or WebP).');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError('Image file is too large (Maximum 12MB).');
      return;
    }

    setError(null);
    setImageFile(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleImageSelected(e.dataTransfer.files[0]);
    }
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setAnalysis(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const runAnalysis = async () => {
    if (!imagePreview) {
      setError('Please upload or paste a chart screenshot first.');
      return;
    }

    setAnalyzing(true);
    setError(null);

    try {
      const res = await fetch('/api/ai/chart-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-user-id': user?.id || '',
          'x-auth-email': user?.email || '',
        },
        body: JSON.stringify({
          image: imagePreview,
          symbol,
          timeframe,
          notes: traderNotes,
          accountId: account?.id,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 403 && data.proRequired) {
          onUpgradeToPro();
          return;
        }
        throw new Error(data.error || 'Failed to analyze chart screenshot.');
      }

      if (data.analysis) {
        setAnalysis(data.analysis);

        // Save to recent analyses history (max 10)
        const newEntry: SavedChartAnalysis = {
          id: `analysis_${Date.now()}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }),
          pair: data.analysis.pairDetected || symbol,
          timeframe: data.analysis.timeframeDetected || timeframe,
          imageThumbnail: imagePreview,
          analysis: data.analysis,
        };

        const updatedHistory = [newEntry, ...history.filter(h => h.id !== newEntry.id)].slice(0, 8);
        setHistory(updatedHistory);
        try {
          localStorage.setItem(`fx_chart_analyses_${user?.id || 'guest'}`, JSON.stringify(updatedHistory));
        } catch {
          // LocalStorage quota safety
        }
      } else {
        throw new Error('Analysis response was empty.');
      }
    } catch (err: any) {
      console.error('[LiveChartAnalysis] Error:', err);
      setError(err.message || 'Error communicating with AI Vision model.');
    } finally {
      setAnalyzing(false);
    }
  };

  const copyToClipboard = (text: string, fieldKey: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldKey);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const getVerdictStyle = (rec: string) => {
    const r = rec.toUpperCase();
    if (r.includes('BUY')) {
      return {
        badge: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
        glow: 'shadow-[0_0_25px_rgba(16,185,129,0.25)]',
        accentBg: 'bg-emerald-500/10 dark:bg-emerald-500/5 border-emerald-500/30',
        textColor: 'text-emerald-500',
        icon: TrendingUp,
        label: 'BUY OPPORTUNITY',
      };
    }
    if (r.includes('SELL')) {
      return {
        badge: 'bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400',
        glow: 'shadow-[0_0_25px_rgba(244,63,94,0.25)]',
        accentBg: 'bg-rose-500/10 dark:bg-rose-500/5 border-rose-500/30',
        textColor: 'text-rose-500',
        icon: TrendingDown,
        label: 'SELL OPPORTUNITY',
      };
    }
    return {
      badge: 'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400',
      glow: 'shadow-[0_0_25px_rgba(245,158,11,0.2)]',
      accentBg: 'bg-amber-500/10 dark:bg-amber-500/5 border-amber-500/30',
      textColor: 'text-amber-500',
      icon: Minus,
      label: 'WAIT / NO TRADE',
    };
  };

  const isPro = !!user?.isPro;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-3 sm:px-6 py-4 md:py-6 max-w-6xl mx-auto w-full space-y-4 sm:space-y-6">
      {/* Header Banner - Fixed height & shrink protection */}
      <div className="shrink-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-violet-700 via-indigo-700 to-purple-700 dark:from-slate-900 dark:via-slate-900/95 dark:to-violet-950/80 border border-violet-500/30 text-white shadow-lg relative overflow-hidden min-h-[76px]">
        {/* Ambient glow blobs */}
        <div className="absolute top-0 right-0 w-72 h-72 bg-white/5 dark:bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-indigo-500/20 rounded-full blur-2xl pointer-events-none" />

        {/* Left: Icon + Title + Subtitle */}
        <div className="relative z-10 flex items-center gap-3 sm:gap-3.5 min-w-0">
          {/* Heyza AI Avatar with Glowing Gradient & Online indicator */}
          <div className="relative shrink-0">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-tr from-violet-500 via-purple-500 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-violet-950/40 border border-white/30 ring-2 ring-white/20">
              <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-violet-900 shadow-[0_0_6px_#34d399]" title="Heyza AI Active" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base sm:text-lg font-black tracking-tight text-white drop-shadow-sm">
                HEYZA AI
              </h1>
              <span className="text-white font-bold text-[10px] sm:text-xs px-2.5 py-0.5 rounded-full bg-white/20 border border-white/30 backdrop-blur-sm shadow-sm whitespace-nowrap">
                Live Chart Vision
              </span>
            </div>
            <p className="text-[11px] sm:text-sm text-white/85 font-normal mt-0.5 leading-snug">
              Upload or paste (<kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-white/20 border border-white/30 text-white font-bold">Ctrl+V</kbd>) MT5 or TradingView chart screenshots for institutional signal analysis.
            </p>
          </div>
        </div>

        {/* Right: AI Scanner Ready badge (shown on sm+ screens) */}
        <div className="relative z-10 hidden sm:flex items-center shrink-0">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 text-xs text-white font-semibold shadow-sm whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#4ade80] shrink-0" />
            <span>AI Scanner Ready</span>
          </span>
        </div>
      </div>

      {/* Main Grid: Upload & Analysis Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Chart Uploader & Settings (5 cols on lg) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-white/10 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-violet-500" />
                <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Chart Screenshot</h2>
              </div>
              {imagePreview && (
                <button
                  type="button"
                  onClick={clearImage}
                  className="text-xs text-slate-400 hover:text-rose-500 transition-colors flex items-center gap-1"
                >
                  <X className="w-3.5 h-3.5" /> Clear
                </button>
              )}
            </div>

            {/* Drag & Drop Upload Zone */}
            <div
              ref={dropZoneRef}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => !imagePreview && fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-xl transition-all duration-200 flex flex-col items-center justify-center p-4 text-center cursor-pointer min-h-[220px] overflow-hidden ${
                isDragging
                  ? 'border-violet-500 bg-violet-500/10 scale-[0.99]'
                  : imagePreview
                  ? 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/40 p-2 cursor-default'
                  : 'border-slate-300 dark:border-slate-700 hover:border-violet-400 dark:hover:border-violet-500 hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleImageSelected(e.target.files[0])}
              />

              {imagePreview ? (
                <div className="relative w-full group">
                  <img
                    src={imagePreview}
                    alt="Chart preview"
                    className="w-full max-h-[280px] object-contain rounded-lg border border-slate-200 dark:border-white/10"
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setShowFullImageModal(true); }}
                      className="p-2 rounded-lg bg-white/20 hover:bg-white/30 text-white backdrop-blur-sm transition-all"
                      title="View Full Screenshot"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                      className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold backdrop-blur-sm transition-all"
                    >
                      Change Image
                    </button>
                  </div>
                </div>
              ) : (
                  <div className="space-y-3 py-4">
                  <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-violet-500 flex items-center justify-center mx-auto">
                    <Upload className="w-6 h-6 animate-bounce" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Drop MT5 or TradingView screenshot here
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                      Or press <kbd className="px-1 py-0.5 text-[10px] font-mono rounded bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300">Ctrl+V</kbd> anywhere to paste
                    </p>
                  </div>
                  <span className="inline-block px-3 py-1 rounded-full text-[11px] font-medium bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-800/40">
                    PNG, JPG, WebP up to 12MB
                  </span>
                </div>
              )}
            </div>

            {/* Quick Context Selectors */}
            <div className="space-y-3 pt-1">
              <div>
                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">
                  Symbol / Pair
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {COMMON_PAIRS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setSymbol(p)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                        symbol === p
                          ? 'bg-violet-600 text-white shadow-sm shadow-violet-500/30'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                  <input
                    type="text"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                    placeholder="Other..."
                    className="w-20 px-2 py-1 rounded-lg text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 outline-none focus:border-violet-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1.5">
                  Chart Timeframe
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => setTimeframe(tf)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                        timeframe === tf
                          ? 'bg-violet-600 text-white shadow-sm shadow-violet-500/30'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                  Optional Trader Notes
                </label>
                <input
                  type="text"
                  value={traderNotes}
                  onChange={(e) => setTraderNotes(e.target.value)}
                  placeholder="e.g. London session liquidity sweep, watching 2640 support..."
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 outline-none focus:border-violet-500"
                />
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Analyze Action Button */}
            <button
              type="button"
              onClick={runAnalysis}
              disabled={analyzing || !imagePreview}
              className={`w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all duration-200 shadow-md ${
                analyzing || !imagePreview
                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed shadow-none'
                  : 'bg-gradient-to-r from-violet-600 via-indigo-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-violet-500/30 active:scale-[0.99] cursor-pointer'
              }`}
            >
              {analyzing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Scanning Chart Geometry & Order Blocks...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-violet-200" />
                  <span>Analyze Live Chart with HEYZA AI</span>
                </>
              )}
            </button>
          </div>

          {/* Past Analyses History Strip */}
          {history.length > 0 && (
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                  <Clock className="w-3.5 h-3.5 text-violet-500" />
                  <span>Recent Scans</span>
                </div>
                <span className="text-[10px] text-slate-400">{history.length} saved</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {history.map((item) => {
                  const isBuy = item.analysis.recommendation.toUpperCase().includes('BUY');
                  const isSell = item.analysis.recommendation.toUpperCase().includes('SELL');
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setAnalysis(item.analysis);
                        setImagePreview(item.imageThumbnail);
                        setSymbol(item.pair);
                        setTimeframe(item.timeframe);
                      }}
                      className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 hover:border-violet-500/40 text-left shrink-0 w-36 transition-all group cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">{item.pair}</span>
                        <span className="text-[10px] font-mono text-slate-400">{item.timeframe}</span>
                      </div>
                      <div className="text-[10px] font-extrabold flex items-center gap-1">
                        <span
                          className={`px-1.5 py-0.5 rounded ${
                            isBuy
                              ? 'bg-emerald-500/20 text-emerald-500'
                              : isSell
                              ? 'bg-rose-500/20 text-rose-500'
                              : 'bg-amber-500/20 text-amber-500'
                          }`}
                        >
                          {item.analysis.recommendation}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: AI Analysis Result Display (7 cols on lg) */}
        <div className="lg:col-span-7 space-y-4">
          {analysis ? (
            <div className="space-y-4 animate-fadeIn">
              {/* Verdict Header Card */}
              {(() => {
                const style = getVerdictStyle(analysis.recommendation);
                const Icon = style.icon;
                return (
                  <div
                    className={`p-5 rounded-2xl border ${style.accentBg} ${style.glow} transition-all duration-300 relative overflow-hidden`}
                  >
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-12 h-12 rounded-2xl flex items-center justify-center border shadow-sm ${style.badge}`}
                        >
                          <Icon className="w-7 h-7" />
                        </div>
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                            Prediction Signal
                          </div>
                          <div className={`text-xl sm:text-2xl font-black tracking-tight ${style.textColor}`}>
                            {style.label}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                          {analysis.pairDetected || symbol} • {analysis.timeframeDetected || timeframe}
                        </span>
                      </div>
                    </div>

                    {/* Dual Confidence Gauges (BUY in green, SELL in red) */}
                    <div className="mt-5 grid grid-cols-2 gap-3 pt-4 border-t border-slate-200/60 dark:border-white/10">
                      {/* BUY Confidence */}
                      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <TrendingUp className="w-3.5 h-3.5" /> BUY Confidence
                          </span>
                          <span className="text-base font-extrabold text-emerald-600 dark:text-emerald-400">
                            {analysis.buyConfidence}%
                          </span>
                        </div>
                        <div className="w-full bg-emerald-950/20 dark:bg-emerald-950/40 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-emerald-500 h-2 rounded-full transition-all duration-500 shadow-sm"
                            style={{ width: `${Math.min(100, Math.max(0, analysis.buyConfidence))}%` }}
                          />
                        </div>
                      </div>

                      {/* SELL Confidence */}
                      <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                            <TrendingDown className="w-3.5 h-3.5" /> SELL Confidence
                          </span>
                          <span className="text-base font-extrabold text-rose-600 dark:text-rose-400">
                            {analysis.sellConfidence}%
                          </span>
                        </div>
                        <div className="w-full bg-rose-950/20 dark:bg-rose-950/40 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-rose-500 h-2 rounded-full transition-all duration-500 shadow-sm"
                            style={{ width: `${Math.min(100, Math.max(0, analysis.sellConfidence))}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Market Trend & Structure Card */}
              <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-white/10 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-violet-500" />
                    <h3 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                      Market Trend & Key Price Levels
                    </h3>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                      analysis.trend.toLowerCase().includes('bull')
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-500'
                        : analysis.trend.toLowerCase().includes('bear')
                        ? 'bg-rose-500/15 border-rose-500/30 text-rose-500'
                        : 'bg-amber-500/15 border-amber-500/30 text-amber-500'
                    }`}
                  >
                    Trend: {analysis.trend}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {/* Support Levels */}
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                    <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" /> Key Support Levels
                    </div>
                    {analysis.supportLevels && analysis.supportLevels.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {analysis.supportLevels.map((lvl, i) => (
                          <span
                            key={i}
                            className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                          >
                            {lvl}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">No clear support detected</span>
                    )}
                  </div>

                  {/* Resistance Levels */}
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                    <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-rose-500" /> Key Resistance Levels
                    </div>
                    {analysis.resistanceLevels && analysis.resistanceLevels.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {analysis.resistanceLevels.map((lvl, i) => (
                          <span
                            key={i}
                            className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30"
                          >
                            {lvl}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400 italic">No clear resistance detected</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Trade Execution Blueprint (Entry / SL / TP) */}
              <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-white/10 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-violet-500" />
                    <h3 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                      Suggested Execution Parameters
                    </h3>
                  </div>
                  {analysis.riskRewardRatio && (
                    <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
                      R:R {analysis.riskRewardRatio}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {/* Suggested Entry */}
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                    <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                      Suggested Entry
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-mono font-black text-slate-900 dark:text-white">
                        {analysis.suggestedEntry || 'Market Execution'}
                      </span>
                      {analysis.suggestedEntry && analysis.suggestedEntry !== 'N/A' && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(analysis.suggestedEntry, 'entry')}
                          className="p-1 text-slate-400 hover:text-violet-500 transition-colors"
                          title="Copy Entry"
                        >
                          {copiedField === 'entry' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Stop Loss */}
                  <div className="p-3 rounded-xl bg-rose-500/5 border border-rose-500/20">
                    <div className="text-[10px] font-bold text-rose-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3" /> Stop Loss (SL)
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-mono font-black text-rose-600 dark:text-rose-400">
                        {analysis.suggestedStopLoss || 'N/A'}
                      </span>
                      {analysis.suggestedStopLoss && analysis.suggestedStopLoss !== 'N/A' && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(analysis.suggestedStopLoss, 'sl')}
                          className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                          title="Copy SL"
                        >
                          {copiedField === 'sl' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Take Profit */}
                  <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                    <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                      <Target className="w-3 h-3" /> Take Profit (TP)
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-mono font-black text-emerald-600 dark:text-emerald-400">
                        {analysis.suggestedTakeProfit || 'N/A'}
                      </span>
                      {analysis.suggestedTakeProfit && analysis.suggestedTakeProfit !== 'N/A' && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(analysis.suggestedTakeProfit, 'tp')}
                          className="p-1 text-slate-400 hover:text-emerald-500 transition-colors"
                          title="Copy TP"
                        >
                          {copiedField === 'tp' ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {onOpenTradeModal && analysis.recommendation !== 'WAIT / NO TRADE' && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenTradeModal({
                        symbol: analysis.pairDetected || symbol,
                        type: analysis.recommendation.toUpperCase().includes('BUY') ? 'Buy' : 'Sell',
                        entryPrice: parseFloat(analysis.suggestedEntry) || undefined,
                        sl: parseFloat(analysis.suggestedStopLoss) || undefined,
                        tp: parseFloat(analysis.suggestedTakeProfit) || undefined,
                        strategy: `HEYZA AI Chart Vision (${analysis.trend})`,
                        notes: `AI Recommendation: ${analysis.recommendation} (${analysis.buyConfidence}% Buy / ${analysis.sellConfidence}% Sell)\n${analysis.explanation}`,
                      });
                    }}
                    className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 transition-all flex items-center justify-center gap-2 cursor-pointer mt-2"
                  >
                    <span>Log Trade in Journal with this Setup</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Explanation & Technical Breakdown */}
              <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-white/10 shadow-sm space-y-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-violet-500" />
                  <h3 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                    Institutional Technical Explanation
                  </h3>
                </div>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {analysis.explanation}
                </p>

                {analysis.keyObservations && analysis.keyObservations.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-white/5 space-y-1.5">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                      Key Technical Observations:
                    </span>
                    <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                      {analysis.keyObservations.map((obs, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-violet-500 mt-0.5 shrink-0" />
                          <span>{obs}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Empty State / Prompt To Upload */
            <div className="p-8 sm:p-12 rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-white/10 text-center flex flex-col items-center justify-center min-h-[420px] space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-violet-600/20 to-indigo-600/20 border border-violet-500/30 text-violet-500 flex items-center justify-center shadow-lg shadow-violet-500/10">
                <BarChart2 className="w-8 h-8 animate-pulse" />
              </div>
              <div className="space-y-1.5 max-w-sm">
                <h3 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100">
                  Ready for Chart Analysis
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                  Upload a live chart screenshot from MT5 or TradingView on the left panel. HEYZA AI will calculate exact Buy/Sell confidence and critical S&R levels.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-left w-full max-w-xs pt-2">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-white/5">
                  <div className="text-[11px] font-bold text-emerald-500">Green = BUY</div>
                  <div className="text-[10px] text-slate-400">High probability bull setup</div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-white/5">
                  <div className="text-[11px] font-bold text-rose-500">Red = SELL</div>
                  <div className="text-[10px] text-slate-400">High probability bear setup</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full Image Zoom Modal */}
      {showFullImageModal && imagePreview && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setShowFullImageModal(false)}
        >
          <div className="relative max-w-5xl w-full max-h-[90vh] flex flex-col items-center">
            <button
              type="button"
              onClick={() => setShowFullImageModal(false)}
              className="absolute -top-10 right-0 p-2 text-white/80 hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={imagePreview}
              alt="Full chart view"
              className="max-w-full max-h-[85vh] object-contain rounded-xl border border-white/20 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
