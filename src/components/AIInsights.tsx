import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  MoreHorizontal,
  Clock,
  X,
  Search,
  ChevronDown,
  RotateCcw,
  AtSign,
  ArrowUp,
  User as UserIcon,
  TrendingUp,
  Brain,
  Shield,
  Zap,
} from 'lucide-react';
import { User, TradingAccount } from '../types';
import ProFeaturePanel from './ProFeaturePanel';

interface AIInsightsProps {
  user: User;
  account: TradingAccount;
  onUpgradeToPro: () => void;
}

interface Message {
  role: 'user' | 'mentor';
  content: string;
  time: string;
}

function getTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatMarkdown(content: string): string {
  if (!content) return '';

  const lines = content.split('\n');
  const formattedLines = lines.map(line => {
    const l = line.trim();
    if (!l) return '<div class="h-2"></div>';

    if (l.startsWith('### ')) {
      return `<h4 class="text-sm font-semibold text-violet-300 mt-2 mb-1">${l.slice(4)}</h4>`;
    }
    if (l.startsWith('## ')) {
      return `<h3 class="text-base font-semibold text-white mt-2.5 mb-1">${l.slice(3)}</h3>`;
    }
    if (l.startsWith('# ')) {
      return `<h2 class="text-lg font-semibold text-white mt-3 mb-1.5">${l.slice(2)}</h2>`;
    }

    if (l.startsWith('• ') || l.startsWith('- ') || l.startsWith('* ')) {
      return `<div class="flex items-start gap-2 my-1 text-slate-300 text-[13px] leading-relaxed"><span class="text-violet-400 font-bold shrink-0 mt-0.5">•</span><span>${l.slice(2)}</span></div>`;
    }

    const numMatch = l.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      return `<div class="flex items-start gap-2 my-1 text-slate-300 text-[13px] leading-relaxed"><span class="text-violet-400 font-medium shrink-0 text-xs mt-0.5">${numMatch[1]}.</span><span>${numMatch[2]}</span></div>`;
    }

    return `<p class="my-0.5 text-slate-300 text-[13px] leading-relaxed">${l}</p>`;
  });

  return formattedLines
    .join('')
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em class="text-violet-200">$1</em>');
}

/**
 * Animated 3D Holographic Particle Wave Sphere
 * Uses FX Journal Pro signature violet, indigo, and cyan theme
 */
const HolographicMeshSphere: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let t = 0;

    const render = () => {
      t += 0.022;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const baseR = 56;

      const numLines = 36;
      for (let i = 0; i < numLines; i++) {
        const phi = (i / numLines) * Math.PI;
        const progress = i / numLines;

        // Rich violet/indigo to cyan gradient matching FX Journal Pro
        const r = Math.floor(139 + progress * (99 - 139));
        const g = Math.floor(92 + progress * (102 - 92));
        const b = Math.floor(246 + progress * (241 - 246));
        const alpha = 0.42 + Math.sin(phi) * 0.5;

        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.lineWidth = 1.25;
        ctx.setLineDash([2, 3]);

        ctx.beginPath();
        const numPoints = 48;
        for (let j = 0; j <= numPoints; j++) {
          const theta = (j / numPoints) * 2 * Math.PI;
          const wave = Math.sin(theta * 3.5 + t + phi * 2.5) * 7 + Math.cos(phi * 4.5 - t * 1.3) * 6;
          const currentR = Math.max(1, (baseR + wave) * Math.sin(phi));

          const x = cx + currentR * Math.cos(theta);
          const y = cy + (baseR + wave) * Math.cos(phi) * 0.88;

          if (j === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="relative flex items-center justify-center my-1 md:my-2">
      {/* Background ambient radial glow matching FX Journal Pro violet */}
      <div
        className="absolute w-36 h-36 sm:w-44 sm:h-44 md:w-56 md:h-56 rounded-full blur-3xl opacity-70 pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.45) 0%, rgba(99, 102, 241, 0.35) 45%, rgba(168, 85, 247, 0.2) 75%, transparent 90%)',
        }}
      />
      <canvas
        ref={canvasRef}
        width={220}
        height={220}
        className="w-28 h-28 sm:w-32 sm:h-32 md:w-48 md:h-48 relative z-10 cursor-pointer drop-shadow-[0_0_30px_rgba(139,92,246,0.6)] transition-transform duration-300 hover:scale-105"
      />
    </div>
  );
};

export default function AIInsights({ user, account, onUpgradeToPro }: AIInsightsProps) {
  const firstName = user?.name ? user.name.split(' ')[0] : 'Trader';

  const initialGreeting: Message = {
    role: 'mentor',
    time: getTime(),
    content: `Hello ${firstName}! I'm **Heyza**, your personal AI trading mentor on **${account.name}**. How can I assist your trading today?`,
  };

  const [messages, setMessages] = useState<Message[]>([initialGreeting]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFindInModal, setShowFindInModal] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [findScope, setFindScope] = useState<'account' | 'all' | 'today'>('account');
  const [activeModel, setActiveModel] = useState('OpenAI GPT-4o Mini');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Suggested Prompts matching FX Journal Pro design language
  const suggestedPrompts = [
    {
      title: "Trade & Win Rate Review",
      icon: TrendingUp,
      iconColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
      text: "Review my recent trades and win rate. How is my discipline holding up?",
    },
    {
      title: "Psychology & Emotional Audit",
      icon: Brain,
      iconColor: "text-violet-400 bg-violet-500/10 border-violet-500/25",
      text: "Analyze my trading psychology and detect emotional triggers behind losing trades.",
    },
    {
      title: "Risk & Drawdown Audit",
      icon: Shield,
      iconColor: "text-amber-400 bg-amber-500/10 border-amber-500/25",
      text: "Audit my risk-to-reward ratio, lot sizing, and drawdown rules.",
    },
    {
      title: "Session Preparation",
      icon: Zap,
      iconColor: "text-sky-400 bg-sky-500/10 border-sky-500/25",
      text: "Help me set up a disciplined checklist before my next trading session.",
    },
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendQuery = async (queryText: string) => {
    if (!queryText.trim() || loading) return;
    const userMsg = queryText.trim();
    setInput('');
    const newMessages: Message[] = [...messages, { role: 'user', content: userMsg, time: getTime() }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const storedUserId = sessionStorage.getItem('auth_user_id') || user?.id || '';
      const storedEmail = sessionStorage.getItem('auth_email') || user?.email || '';
      const response = await fetch('/api/ai/mentor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(storedUserId ? { 'x-auth-user-id': storedUserId } : {}),
          ...(storedEmail ? { 'x-auth-email': storedEmail } : {}),
        },
        body: JSON.stringify({
          accountId: account.id,
          messages: newMessages.slice(-10),
          scope: findScope,
          model: activeModel,
        }),
      });
      const data = await response.json();
      if (data.reply) {
        setMessages(prev => [...prev, { role: 'mentor', content: data.reply, time: getTime() }]);
      } else if (data.error) {
        setMessages(prev => [...prev, { role: 'mentor', content: `Error: ${data.error}`, time: getTime() }]);
      }
    } catch (e) {
      console.error(e);
      setMessages(prev => [
        ...prev,
        { role: 'mentor', content: "I'm having a brief connection issue. Please retry in a moment! 😊", time: getTime() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (input.trim()) {
        sendQuery(input);
      }
    }
  };

  const handleResetChat = () => {
    setMessages([initialGreeting]);
    setInput('');
    setShowHistoryModal(false);
  };

  if (!user.isPro) {
    return (
      <ProFeaturePanel
        title="Meet Heyza — Your AI Trading Mentor"
        blurb="Chat with Heyza to audit your trading psychology, detect emotional patterns, and get personalized insights directly from your MT5 trades."
        onUpgrade={onUpgradeToPro}
      />
    );
  }

  const isHeroMode = messages.length <= 1;

  return (
    <div className="w-full h-full flex justify-center py-1 sm:py-6 px-1 sm:px-4">
      {/* ── Main Chat Window Matching FX Journal Pro Signature Design ── */}
      <div
        id="ai-assistant-card"
        className="relative w-full max-w-full sm:max-w-[440px] md:max-w-4xl lg:max-w-5xl rounded-[24px] md:rounded-[32px] overflow-hidden border border-slate-200/80 dark:border-white/[0.08] flex flex-col justify-between transition-all duration-300 shadow-2xl bg-white dark:bg-[#090b14]"
        style={{
          minHeight: '480px',
          height: 'min(680px, calc(100dvh - 135px))',
          boxShadow: '0 30px 80px -20px rgba(0, 0, 0, 0.9), 0 0 50px -15px rgba(139, 92, 246, 0.18)',
        }}
      >
        {/* Subtle Ambient Violet Glow on Top */}
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[500px] h-[300px] bg-gradient-to-b from-violet-600/20 via-purple-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />

        {/* ── Top Header Bar ── */}
        <div className="flex items-center justify-between px-5 md:px-7 pt-4 pb-3 shrink-0 bg-transparent border-b border-slate-100 dark:border-white/[0.05] relative z-10">
          {/* Left: Sparkle Badge + Title + Active Account Pill */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-400 shadow-sm shadow-violet-500/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-900 dark:text-white font-bold text-[15px] tracking-tight">Heyza AI</span>
              <span className="px-1.5 py-0.5 rounded-md bg-violet-500/15 border border-violet-500/25 text-[9px] font-extrabold uppercase tracking-wider text-violet-600 dark:text-violet-300">
                Coach
              </span>
            </div>
            <span className="hidden md:inline-flex items-center gap-1.5 ml-2 px-3 py-1 rounded-full bg-slate-100 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/[0.08] text-[11px] text-slate-600 dark:text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
              <span className="font-medium">{account.name}</span>
            </span>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 text-slate-400 dark:text-slate-400">
            <button
              onClick={() => setShowModelModal(prev => !prev)}
              className="hover:text-slate-800 dark:hover:text-white p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.06] transition cursor-pointer"
              title="Model Settings"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowHistoryModal(prev => !prev)}
              className="hover:text-slate-800 dark:hover:text-white p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.06] transition cursor-pointer"
              title="Chat History"
            >
              <Clock className="w-4 h-4" />
            </button>
            <button
              onClick={handleResetChat}
              className="hover:text-slate-800 dark:hover:text-white p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.06] transition cursor-pointer"
              title="Reset Chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Middle Body: Hero Mesh or Chat Stream ── */}
        <div className="flex-1 overflow-y-auto px-4 md:px-7 py-2 custom-scrollbar flex flex-col min-h-0 relative z-10">
          {isHeroMode ? (
            /* HERO MODE: Symmetrically Centered on Desktop & Mobile */
            <div className="flex flex-col items-center justify-center my-auto py-2 text-center animate-fadeIn w-full max-w-4xl mx-auto space-y-3 md:space-y-4">
              {/* Centered Holographic Mesh Orb */}
              <div className="relative flex items-center justify-center">
                <HolographicMeshSphere />
              </div>

              {/* Centered Greetings */}
              <div className="space-y-1 text-center">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/25 text-xs font-semibold text-violet-400 mb-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI Trading Mentor</span>
                </div>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                  Hello, {firstName}!
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium max-w-md mx-auto">
                  How can Heyza assist your trading discipline today?
                </p>
              </div>

              {/* MOBILE: Sleek chat suggestion bubbles */}
              <div className="flex md:hidden flex-col gap-2 w-full max-w-[340px] pt-1">
                <button
                  type="button"
                  onClick={() => sendQuery("Review my recent trades and win rate. How is my discipline holding up?")}
                  className="rounded-2xl rounded-tr-md bg-slate-50 dark:bg-[#121524] hover:bg-slate-100 dark:hover:bg-[#191d32] active:scale-[0.98] border border-slate-200 dark:border-white/[0.08] p-3 text-left text-[12.5px] text-slate-700 dark:text-slate-300 leading-relaxed shadow-sm transition cursor-pointer"
                >
                  Review my recent trades and win rate. How is my discipline holding up?
                </button>
                <button
                  type="button"
                  onClick={() => sendQuery("Analyze my trading psychology and detect emotional triggers behind losing trades.")}
                  className="rounded-2xl rounded-tr-md bg-slate-50 dark:bg-[#121524] hover:bg-slate-100 dark:hover:bg-[#191d32] active:scale-[0.98] border border-slate-200 dark:border-white/[0.08] p-3 text-left text-[12.5px] text-slate-700 dark:text-slate-300 leading-relaxed shadow-sm transition cursor-pointer"
                >
                  Analyze my trading psychology and detect emotional triggers behind losing trades.
                </button>
              </div>

              {/* DESKTOP: 4-Column Card Grid Matching FX Journal Pro */}
              <div className="hidden md:grid md:grid-cols-4 gap-3 w-full pt-2">
                {suggestedPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => sendQuery(prompt.text)}
                    className="text-left p-4 rounded-2xl bg-slate-50/80 dark:bg-[#0e111d]/90 hover:bg-slate-100 dark:hover:bg-[#141828] border border-slate-200/80 dark:border-white/[0.08] hover:border-violet-500/40 hover:shadow-[0_10px_30px_-8px_rgba(139,92,246,0.25)] transition-all duration-200 cursor-pointer group flex flex-col justify-between active:scale-[0.98]"
                    style={{ minHeight: '105px' }}
                  >
                    <div className="flex items-center gap-2.5 mb-2">
                      <span className={`w-7 h-7 rounded-xl flex items-center justify-center border transition shrink-0 group-hover:scale-105 ${prompt.iconColor}`}>
                        <prompt.icon className="w-4 h-4" />
                      </span>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-violet-600 dark:group-hover:text-violet-300 transition line-clamp-1">
                        {prompt.title}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-300 leading-relaxed line-clamp-2">
                      {prompt.text}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* CONVERSATION STREAM MODE */
            <div className="space-y-4 w-full max-w-3xl mx-auto pt-2 animate-fadeIn">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2.5`}
                >
                  {msg.role === 'mentor' && (
                    <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 shrink-0 mt-1 flex items-center justify-center text-[11px] font-bold text-white shadow-sm shadow-violet-500/30">
                      <Sparkles className="w-3.5 h-3.5" />
                    </div>
                  )}

                  <div className={`flex flex-col gap-1 max-w-[88%] md:max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`px-4 py-3 rounded-2xl text-[13px] leading-relaxed shadow-sm ${
                        msg.role === 'user'
                          ? 'bg-violet-600 text-white rounded-tr-sm'
                          : 'bg-slate-100 dark:bg-[#121524] text-slate-800 dark:text-slate-200 border border-slate-200/80 dark:border-white/[0.08] rounded-tl-sm'
                      }`}
                      dangerouslySetInnerHTML={{
                        __html: formatMarkdown(msg.content),
                      }}
                    />
                    <span className="text-[9px] text-slate-400 px-1">{msg.time}</span>
                  </div>

                  {msg.role === 'user' && (
                    <div className="w-7 h-7 rounded-xl bg-slate-800 border border-white/10 flex items-center justify-center shrink-0 mt-1">
                      <UserIcon className="w-3.5 h-3.5 text-slate-300" />
                    </div>
                  )}
                </div>
              ))}

              {/* Typing indicator */}
              {loading && (
                <div className="flex justify-start gap-2.5 items-center">
                  <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 shrink-0 flex items-center justify-center text-[11px] font-bold text-white shadow-sm shadow-violet-500/30">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <div className="px-4 py-2.5 rounded-2xl bg-slate-100 dark:bg-[#121524] border border-slate-200/80 dark:border-white/[0.08] flex items-center gap-1.5 rounded-tl-sm">
                    {[0, 150, 300].map(delay => (
                      <div
                        key={delay}
                        className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce"
                        style={{ animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── Bottom Section: Action Pills + Pill Input Bar ── */}
        <div className="shrink-0 px-4 md:px-7 pb-4 pt-2 bg-transparent space-y-2.5 relative z-10 border-t border-slate-100 dark:border-white/[0.05]">
          {/* Action Pills Row */}
          <div className="flex items-center gap-2">
            {/* Pill 1: Find in ⌵ */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowFindInModal(prev => !prev);
                  setShowModelModal(false);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/[0.05] hover:bg-slate-200 dark:hover:bg-white/[0.09] border border-slate-200 dark:border-white/10 text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition cursor-pointer font-medium"
              >
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <span>Find in</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {showFindInModal && (
                <div className="absolute bottom-9 left-0 w-44 rounded-xl bg-white dark:bg-[#131625] border border-slate-200 dark:border-white/10 p-1.5 shadow-2xl z-30 text-xs animate-fadeIn space-y-1">
                  <button
                    onClick={() => { setFindScope('account'); setShowFindInModal(false); }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg transition ${findScope === 'account' ? 'bg-violet-600/15 text-violet-600 dark:text-violet-300 font-semibold' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                  >
                    Current: {account.name}
                  </button>
                  <button
                    onClick={() => { setFindScope('today'); setShowFindInModal(false); }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg transition ${findScope === 'today' ? 'bg-violet-600/15 text-violet-600 dark:text-violet-300 font-semibold' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                  >
                    Today's Trades
                  </button>
                  <button
                    onClick={() => { setFindScope('all'); setShowFindInModal(false); }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg transition ${findScope === 'all' ? 'bg-violet-600/15 text-violet-600 dark:text-violet-300 font-semibold' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                  >
                    All Accounts
                  </button>
                </div>
              )}
            </div>

            {/* Pill 2: Model select */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowModelModal(prev => !prev);
                  setShowFindInModal(false);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/[0.05] hover:bg-slate-200 dark:hover:bg-white/[0.09] border border-slate-200 dark:border-white/10 text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition cursor-pointer font-medium"
              >
                <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-violet-500 to-indigo-500 shrink-0" />
                <span className="font-semibold">{activeModel.includes('GPT') ? 'GPT-4o Mini' : 'Gemma 4'}</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {showModelModal && (
                <div className="absolute bottom-9 left-0 w-56 rounded-xl bg-white dark:bg-[#131625] border border-slate-200 dark:border-white/10 p-1.5 shadow-2xl z-30 text-xs animate-fadeIn space-y-1">
                  <div className="px-2.5 py-1 text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    Select AI Engine
                  </div>
                  <button
                    onClick={() => { setActiveModel('OpenAI GPT-4o Mini'); setShowModelModal(false); }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg transition ${activeModel.includes('GPT') ? 'bg-violet-600/15 text-violet-600 dark:text-violet-300 font-semibold' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                  >
                    <div className="font-medium">OpenAI GPT-4o Mini</div>
                    <div className="text-[10px] text-slate-400">Fast, smart trading analysis</div>
                  </button>
                  <button
                    onClick={() => { setActiveModel('Google Gemma 4'); setShowModelModal(false); }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg transition ${activeModel.includes('Gemma') ? 'bg-violet-600/15 text-violet-600 dark:text-violet-300 font-semibold' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5'}`}
                  >
                    <div className="font-medium">Google Gemma 4</div>
                    <div className="text-[10px] text-slate-400">Free open-source model</div>
                  </button>
                </div>
              )}
            </div>

            {/* Pill 3: Reset */}
            <button
              type="button"
              onClick={handleResetChat}
              className="w-7 h-7 rounded-full bg-slate-100 dark:bg-white/[0.05] hover:bg-slate-200 dark:hover:bg-white/[0.09] border border-slate-200 dark:border-white/10 text-slate-400 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition cursor-pointer"
              title="Reset Chat"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Pill Input Bar */}
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-[#0c0e18] border border-slate-200/90 dark:border-white/10 focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-500/20 rounded-full pl-4 pr-1.5 py-1.5 transition-all duration-200 shadow-sm">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Heyza anything about your trades, risk, or strategy..."
              disabled={loading}
              className="chat-clean-input flex-1 text-[13px] md:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 leading-relaxed min-w-0 bg-transparent border-0 outline-none"
            />

            <div className="flex items-center gap-1.5 shrink-0 pr-0.5">
              {/* @ mention button */}
              <button
                type="button"
                onClick={() => setInput(prev => `${prev}@${account.name} `)}
                className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 active:scale-95 flex items-center justify-center transition cursor-pointer"
                title="Tag account"
              >
                <AtSign className="w-4 h-4" />
              </button>

              {/* Up arrow send button with signature violet theme */}
              <button
                type="button"
                onClick={() => { if (input.trim()) sendQuery(input); }}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-white transition-all duration-200 cursor-pointer shrink-0 active:scale-95 ${
                  input.trim()
                    ? 'bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 shadow-md shadow-violet-600/40'
                    : 'bg-violet-700/60 hover:bg-violet-600 text-white/70'
                }`}
                aria-label="Send"
              >
                <ArrowUp className="w-4 h-4 stroke-[2.8]" />
              </button>
            </div>
          </div>
        </div>

        {/* History Modal */}
        {showHistoryModal && (
          <div className="absolute inset-0 bg-white/95 dark:bg-[#0c0d16]/95 backdrop-blur-md p-6 z-40 flex flex-col justify-between animate-fadeIn">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-white/10">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Chat Sessions</h3>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="py-4 space-y-2">
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#131625] border border-slate-200 dark:border-white/5 text-xs text-slate-700 dark:text-slate-300">
                  <div className="font-semibold text-slate-900 dark:text-white mb-1">Active Session</div>
                  <div className="text-slate-500 dark:text-slate-400 line-clamp-1">{messages[messages.length - 1]?.content || 'Started'}</div>
                </div>
              </div>
            </div>

            <button
              onClick={handleResetChat}
              className="w-full py-3 rounded-xl bg-slate-900 dark:bg-violet-600 hover:bg-slate-800 dark:hover:bg-violet-500 text-xs font-semibold text-white transition flex items-center justify-center gap-2 shadow-md shadow-violet-600/20 active:scale-95"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Start New Session</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
