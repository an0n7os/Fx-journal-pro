import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Clock,
  X,
  Search,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  AtSign,
  ArrowUp,
  User as UserIcon,
  TrendingUp,
  Brain,
  Shield,
  Zap,
  Plus,
  Trash2,
  MessageSquare,
} from 'lucide-react';
import { User, TradingAccount } from '../types';
import ProFeaturePanel from './ProFeaturePanel';
import { useScrollLock } from '../lib/useScrollLock';

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

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

const getStorageKey = (userId?: string, accountId?: string) =>
  `fx_ai_sessions_${userId || 'guest'}_${accountId || 'default'}`;

const getActiveKey = (userId?: string, accountId?: string) =>
  `fx_ai_active_session_${userId || 'guest'}_${accountId || 'default'}`;

function loadStoredSessions(userId?: string, accountId?: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(getStorageKey(userId, accountId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to parse stored chat sessions:', e);
  }
  return [];
}

function saveStoredSessions(userId?: string, accountId?: string, sessions?: ChatSession[]) {
  try {
    if (!sessions) return;
    localStorage.setItem(getStorageKey(userId, accountId), JSON.stringify(sessions));
  } catch (e) {
    console.warn('Failed to save chat sessions to localStorage:', e);
  }
}

function formatSessionDate(timestamp: number): string {
  if (!timestamp) return 'Recently';
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) {
    return `Today at ${timeStr}`;
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${timeStr}`;
  }
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
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
    <div className="relative flex items-center justify-center my-0 sm:my-1 md:my-2">
      {/* Background ambient radial glow matching FX Journal Pro violet */}
      <div
        className="absolute w-28 h-28 sm:w-40 sm:h-40 md:w-56 md:h-56 rounded-full blur-2xl sm:blur-3xl opacity-60 pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(139, 92, 246, 0.45) 0%, rgba(99, 102, 241, 0.35) 45%, rgba(168, 85, 247, 0.2) 75%, transparent 90%)',
        }}
      />
      <canvas
        ref={canvasRef}
        width={220}
        height={220}
        className="w-20 h-20 sm:w-28 sm:h-28 md:w-44 md:h-44 relative z-10 cursor-pointer drop-shadow-[0_0_24px_rgba(139,92,246,0.6)] transition-transform duration-300 hover:scale-105"
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

  // Persistent chat sessions state
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const loaded = loadStoredSessions(user?.id, account.id);
    if (loaded.length > 0) return loaded;
    return [{
      id: `session_${Date.now()}`,
      title: 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [initialGreeting],
    }];
  });

  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    const activeId = localStorage.getItem(getActiveKey(user?.id, account.id));
    const loaded = loadStoredSessions(user?.id, account.id);
    if (activeId && loaded.some(s => s.id === activeId)) {
      return activeId;
    }
    if (loaded.length > 0) {
      return loaded[0].id;
    }
    return `session_${Date.now()}`;
  });

  const [messages, setMessages] = useState<Message[]>(() => {
    const activeId = localStorage.getItem(getActiveKey(user?.id, account.id));
    const loaded = loadStoredSessions(user?.id, account.id);
    const active = loaded.find(s => s.id === activeId) || loaded[0];
    if (active && active.messages && active.messages.length > 0) {
      return active.messages;
    }
    return [initialGreeting];
  });

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFindInModal, setShowFindInModal] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [findScope, setFindScope] = useState<'account' | 'all' | 'today'>('account');
  const [activeModel, setActiveModel] = useState('OpenAI GPT-4o Mini');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Lock background scroll when history modal is open
  useScrollLock(showHistoryModal);

  // Sync sessions when account or user changes
  useEffect(() => {
    const loaded = loadStoredSessions(user?.id, account.id);
    const activeId = localStorage.getItem(getActiveKey(user?.id, account.id));
    if (loaded.length > 0) {
      const active = loaded.find(s => s.id === activeId) || loaded[0];
      setSessions(loaded);
      setCurrentSessionId(active.id);
      setMessages(active.messages?.length > 0 ? active.messages : [initialGreeting]);
    } else {
      const fresh: ChatSession = {
        id: `session_${Date.now()}`,
        title: 'New Conversation',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [initialGreeting],
      };
      setSessions([fresh]);
      setCurrentSessionId(fresh.id);
      setMessages([initialGreeting]);
      saveStoredSessions(user?.id, account.id, [fresh]);
      localStorage.setItem(getActiveKey(user?.id, account.id), fresh.id);
    }
  }, [account.id, user?.id]);

  // Persist current session messages whenever messages change
  useEffect(() => {
    if (!currentSessionId) return;

    setSessions(prevSessions => {
      const exists = prevSessions.some(s => s.id === currentSessionId);
      const firstUserMsg = messages.find(m => m.role === 'user');
      const dynamicTitle = firstUserMsg
        ? (firstUserMsg.content.length > 36 ? firstUserMsg.content.slice(0, 36) + '...' : firstUserMsg.content)
        : 'New Conversation';

      let updated: ChatSession[];
      if (exists) {
        updated = prevSessions.map(s => {
          if (s.id === currentSessionId) {
            return {
              ...s,
              messages,
              updatedAt: Date.now(),
              title: s.title === 'New Conversation' ? dynamicTitle : s.title,
            };
          }
          return s;
        });
      } else {
        updated = [
          {
            id: currentSessionId,
            title: dynamicTitle,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages,
          },
          ...prevSessions,
        ];
      }

      saveStoredSessions(user?.id, account.id, updated);
      localStorage.setItem(getActiveKey(user?.id, account.id), currentSessionId);
      return updated;
    });
  }, [messages, currentSessionId, user?.id, account.id]);

  // Start a fresh new chat session
  const handleNewChat = () => {
    const freshId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newSession: ChatSession = {
      id: freshId,
      title: 'New Conversation',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [initialGreeting],
    };

    setSessions(prev => {
      // Retain only meaningful past sessions (those with user questions) plus the new session
      const meaningful = prev.filter(s => s.messages.some(m => m.role === 'user'));
      const nextSessions = [newSession, ...meaningful];
      saveStoredSessions(user?.id, account.id, nextSessions);
      return nextSessions;
    });

    setCurrentSessionId(freshId);
    setMessages([initialGreeting]);
    setInput('');
    setShowHistoryModal(false);
    localStorage.setItem(getActiveKey(user?.id, account.id), freshId);
  };

  // Switch to an existing past session
  const handleSelectSession = (session: ChatSession) => {
    setCurrentSessionId(session.id);
    setMessages(session.messages && session.messages.length > 0 ? session.messages : [initialGreeting]);
    setInput('');
    setShowHistoryModal(false);
    localStorage.setItem(getActiveKey(user?.id, account.id), session.id);
  };

  // Delete an existing session
  const handleDeleteSession = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    const nextSessions = sessions.filter(s => s.id !== sessionId);
    setSessions(nextSessions);
    saveStoredSessions(user?.id, account.id, nextSessions);

    if (currentSessionId === sessionId) {
      if (nextSessions.length > 0) {
        handleSelectSession(nextSessions[0]);
      } else {
        handleNewChat();
      }
    }
  };

  const handleResetChat = () => {
    handleNewChat();
  };

  // Suggested Prompts matching FX Journal Pro design language
  const suggestedPrompts = [
    {
      title: "Win Rate & Setups",
      icon: TrendingUp,
      iconColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/25",
      text: "Review recent trades, win rate, and setup discipline.",
    },
    {
      title: "Psychology Audit",
      icon: Brain,
      iconColor: "text-violet-400 bg-violet-500/10 border-violet-500/25",
      text: "Detect emotional triggers and revenge trading patterns.",
    },
    {
      title: "Risk & Drawdown",
      icon: Shield,
      iconColor: "text-amber-400 bg-amber-500/10 border-amber-500/25",
      text: "Audit risk-to-reward ratio, lot sizing, and drawdown rules.",
    },
    {
      title: "Session Prep",
      icon: Zap,
      iconColor: "text-sky-400 bg-sky-500/10 border-sky-500/25",
      text: "Set up a disciplined checklist before the next session.",
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
    <div className="w-full h-full flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#090b14]">
      {/* ── Main Chat Window Full Width & Fixed on PC ── */}
      <div
        id="ai-assistant-card"
        className="relative w-full h-full flex-1 flex flex-col justify-between overflow-hidden border-0 rounded-none bg-white dark:bg-[#090b14] transition-all duration-300"
      >
        {/* Subtle Ambient Violet Glow on Top */}
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[700px] h-[300px] bg-gradient-to-b from-violet-600/15 via-purple-600/5 to-transparent rounded-full blur-3xl pointer-events-none" />

        {/* ── Top Header Bar ── */}
        <div className="flex items-center justify-between px-4 sm:px-8 md:px-12 py-3 sm:py-3.5 shrink-0 bg-white/70 dark:bg-[#090b14]/70 backdrop-blur-xl border-b border-slate-200/60 dark:border-white/[0.06] relative z-10">
          <div className="w-full max-w-5xl mx-auto flex items-center justify-between">
            {/* Left: Sparkle Badge + Title + Active Account Pill */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center text-violet-400 shadow-sm shadow-violet-500/20 shrink-0">
                <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <span className="text-slate-900 dark:text-white font-bold text-sm sm:text-[15px] tracking-tight">Heyza AI</span>
              </div>
              <span className="inline-flex items-center gap-1 sm:gap-1.5 ml-1 sm:ml-2 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full bg-slate-100 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/[0.08] text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-300 truncate max-w-[110px] sm:max-w-none">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399] shrink-0" />
                <span className="font-medium truncate">{account.name}</span>
              </span>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-1.5 sm:gap-2 text-slate-400 dark:text-slate-400 shrink-0">
              {/* New Chat Button */}
              <button
                onClick={handleNewChat}
                className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-xl bg-violet-600/10 dark:bg-violet-500/15 border border-violet-500/25 hover:bg-violet-600 hover:text-white text-violet-600 dark:text-violet-300 text-xs font-semibold transition cursor-pointer active:scale-95 shadow-sm"
                title="Start a fresh conversation"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="text-xs">New Chat</span>
              </button>

              {/* Chat History Button */}
              <button
                onClick={() => setShowHistoryModal(prev => !prev)}
                className="relative hover:text-slate-800 dark:hover:text-white p-1.5 sm:p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.06] transition cursor-pointer text-slate-500 dark:text-slate-400"
                title="Chat History"
              >
                <Clock className="w-4 h-4" />
                {sessions.filter(s => s.messages.some(m => m.role === 'user')).length > 1 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-violet-500 ring-2 ring-white dark:ring-[#090b14]" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── Middle Body: Hero Mesh or Chat Stream ── */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-2 custom-scrollbar flex flex-col min-h-0 relative z-10">
          {isHeroMode ? (
            /* HERO MODE: Symmetrically Centered on Desktop & Mobile */
            <div className="flex flex-col items-center justify-center my-auto py-3 sm:py-5 text-center animate-fadeIn w-full max-w-4xl mx-auto space-y-3 sm:space-y-4">
              {/* Centered Holographic Mesh Orb */}
              <div className="relative flex items-center justify-center">
                <HolographicMeshSphere />
              </div>

              {/* Centered Greetings */}
              <div className="space-y-1 text-center px-2">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/25 text-[11px] font-semibold text-violet-400 mb-0.5">
                  <Sparkles className="w-3 h-3 text-violet-400" />
                  <span>AI Trading Mentor</span>
                </div>
                <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-transparent dark:bg-clip-text dark:bg-gradient-to-r dark:from-white dark:via-slate-100 dark:to-slate-300 tracking-tight">
                  Hello, {firstName}!
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-medium max-w-md mx-auto">
                  How can Heyza assist your trading discipline today?
                </p>
              </div>

              {/* MOBILE: Sleek chat suggestion cards */}
              <div className="flex md:hidden flex-col gap-2 w-full max-w-[340px] px-1 pt-1">
                <button
                  type="button"
                  onClick={() => sendQuery("Review recent trades, win rate, and setup discipline.")}
                  className="group flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50/90 dark:bg-white/[0.03] hover:bg-slate-100 dark:hover:bg-white/[0.06] active:scale-[0.98] border border-slate-200/80 dark:border-white/[0.08] text-left transition-all duration-150 shadow-sm cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 flex items-center justify-center shrink-0">
                    <TrendingUp className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] font-bold text-slate-800 dark:text-slate-200 group-hover:text-emerald-400 transition-colors">
                      Win Rate & Setups
                    </div>
                    <div className="text-[10.5px] text-slate-500 dark:text-slate-400 line-clamp-1 leading-snug">
                      Audit recent win rate, setups & discipline
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-400 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => sendQuery("Detect emotional triggers and revenge trading patterns.")}
                  className="group flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-50/90 dark:bg-white/[0.03] hover:bg-slate-100 dark:hover:bg-white/[0.06] active:scale-[0.98] border border-slate-200/80 dark:border-white/[0.08] text-left transition-all duration-150 shadow-sm cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/25 text-violet-400 flex items-center justify-center shrink-0">
                    <Brain className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11.5px] font-bold text-slate-800 dark:text-slate-200 group-hover:text-violet-400 transition-colors">
                      Psychology Audit
                    </div>
                    <div className="text-[10.5px] text-slate-500 dark:text-slate-400 line-clamp-1 leading-snug">
                      Detect revenge trading & emotional triggers
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-violet-400 shrink-0" />
                </button>
              </div>

              {/* DESKTOP: 4-Column Card Grid Matching FX Journal Pro */}
              <div className="hidden md:grid md:grid-cols-4 gap-3 w-full pt-2">
                {suggestedPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => sendQuery(prompt.text)}
                    className="text-left p-3.5 rounded-2xl bg-slate-50/80 dark:bg-[#0e111d]/90 hover:bg-slate-100 dark:hover:bg-[#141828] border border-slate-200/80 dark:border-white/[0.08] hover:border-violet-500/40 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-8px_rgba(139,92,246,0.25)] transition-all duration-200 cursor-pointer group flex flex-col justify-between active:scale-[0.98]"
                    style={{ minHeight: '108px' }}
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`w-7 h-7 rounded-xl flex items-center justify-center border transition shrink-0 group-hover:scale-105 ${prompt.iconColor}`}>
                          <prompt.icon className="w-4 h-4" />
                        </span>
                        <span className="text-[12.5px] font-bold text-slate-800 dark:text-slate-200 group-hover:text-violet-600 dark:group-hover:text-violet-300 transition truncate">
                          {prompt.title}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-300 leading-relaxed line-clamp-2">
                        {prompt.text}
                      </p>
                    </div>
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

        {/* ── Bottom Section: Modern Unified Prompt Console ── */}
        <div className="shrink-0 px-4 sm:px-8 md:px-12 pb-3.5 sm:pb-4 pt-2 bg-gradient-to-t from-white via-white/95 to-transparent dark:from-[#090b14] dark:via-[#090b14]/95 dark:to-transparent relative z-20">
          <div className="w-full max-w-4xl mx-auto space-y-2">
            {/* Single Inline Pill Bar */}
            <div className="flex items-center gap-1.5 sm:gap-2 bg-slate-50 dark:bg-[#0c0e18] border border-slate-200/90 dark:border-white/10 focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-500/20 rounded-full pl-2 sm:pl-3 pr-1.5 py-1.5 transition-all shadow-sm">
              
              {/* Left Inline Tool 1: Scope Selector */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowFindInModal(prev => !prev);
                    setShowModelModal(false);
                  }}
                  className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-full bg-slate-200/70 dark:bg-white/[0.06] hover:bg-slate-300/70 dark:hover:bg-white/10 text-[11px] sm:text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
                  title="Search scope"
                >
                  <Search className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="truncate max-w-[70px] sm:max-w-[110px]">
                    {findScope === 'account' ? account.name : findScope === 'today' ? "Today" : "All"}
                  </span>
                  <ChevronDown className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                </button>

                {showFindInModal && (
                  <div className="absolute bottom-full mb-3 left-0 w-48 rounded-xl bg-white dark:bg-[#131625] border border-slate-200 dark:border-white/10 p-1.5 shadow-2xl z-50 text-xs animate-fadeIn space-y-1">
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

              {/* Left Inline Tool 2: Model Selector */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setShowModelModal(prev => !prev);
                    setShowFindInModal(false);
                  }}
                  className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-full bg-slate-200/70 dark:bg-white/[0.06] hover:bg-slate-300/70 dark:hover:bg-white/10 text-[11px] sm:text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
                  title="Select AI Model"
                >
                  <div className="w-2 h-2 rounded-full bg-gradient-to-tr from-violet-500 to-indigo-500 shrink-0" />
                  <span className="truncate max-w-[80px] sm:max-w-none">
                    {activeModel.includes('GPT') ? 'GPT-4o Mini' : 'Gemma 4'}
                  </span>
                  <ChevronDown className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                </button>

                {showModelModal && (
                  <div className="absolute bottom-full mb-3 left-0 w-56 rounded-xl bg-white dark:bg-[#131625] border border-slate-200 dark:border-white/10 p-1.5 shadow-2xl z-50 text-xs animate-fadeIn space-y-1">
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

              {/* Subtle Vertical Divider */}
              <div className="h-4 w-px bg-slate-300 dark:bg-white/10 shrink-0 hidden sm:block" />

              {/* Flexible Input Field with bright, clearly visible caret */}
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Heyza anything about your trades or strategy..."
                disabled={loading}
                className="chat-clean-input flex-1 min-w-[80px] text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 bg-transparent border-0 outline-none caret-violet-500 dark:caret-violet-400 px-1 py-1"
              />

              {/* Right Action Buttons */}
              <div className="flex items-center gap-1 shrink-0 pr-0.5">
                {/* Tag Account Button */}
                <button
                  type="button"
                  onClick={() => setInput(prev => `${prev}@${account.name} `)}
                  className="w-7 h-7 sm:w-8 sm:h-8 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 flex items-center justify-center transition cursor-pointer"
                  title={`Tag ${account.name}`}
                >
                  <AtSign className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </button>

                {/* Reset / New Chat Button */}
                <button
                  type="button"
                  onClick={handleNewChat}
                  className="w-7 h-7 sm:w-8 sm:h-8 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 flex items-center justify-center transition cursor-pointer"
                  title="New Chat / Reset"
                >
                  <RotateCcw className="w-3.5 h-3.5 sm:w-3.5 sm:h-3.5" />
                </button>

                {/* Up Arrow Send Button */}
                <button
                  type="button"
                  onClick={() => { if (input.trim()) sendQuery(input); }}
                  disabled={!input.trim() || loading}
                  className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer shrink-0 active:scale-95 ${input.trim() ? "bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white shadow-md shadow-violet-600/40" : "bg-violet-700/60 hover:bg-violet-600 text-white/70"}`}
                  aria-label="Send"
                >
                  <ArrowUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.8]" />
                </button>
              </div>
            </div>
            {/* Micro Caption */}
            <div className="flex items-center justify-center gap-1.5 text-[10.5px] sm:text-[11px] text-slate-400 dark:text-slate-500">
              <Sparkles className="w-3 h-3 text-violet-400/70" />
              <span>Heyza AI analyzes live MT5 journal data to strengthen discipline and risk rules</span>
            </div>
          </div>
        </div>
      </div>

        {/* Rich Chat History Modal */}
        {showHistoryModal && (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fadeIn overscroll-contain modal-backdrop-contain"
            onClick={() => setShowHistoryModal(false)}
          >
            <div
              className="relative w-full max-w-lg bg-white dark:bg-[#0e111e] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-scaleUp"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-violet-500/10 border border-violet-500/25 flex items-center justify-center text-violet-400">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Chat History</h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Saved conversations on <span className="font-semibold text-slate-700 dark:text-slate-300">{account.name}</span>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  className="text-slate-400 hover:text-slate-800 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 transition cursor-pointer"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Action: Start New Chat */}
              <div className="p-4 border-b border-slate-200/80 dark:border-white/[0.06]">
                <button
                  onClick={handleNewChat}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-violet-600/20 active:scale-95 transition cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Start New Conversation</span>
                </button>
              </div>

              {/* Sessions List */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
                {sessions.length === 0 || (sessions.length === 1 && !sessions[0].messages.some(m => m.role === 'user')) ? (
                  <div className="text-center py-10 px-4">
                    <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-violet-400 flex items-center justify-center mx-auto mb-3">
                      <MessageSquare className="w-6 h-6 opacity-70" />
                    </div>
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">No Past Conversations Yet</div>
                    <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                      Any questions you ask Heyza will be automatically saved here so you can revisit them anytime.
                    </p>
                  </div>
                ) : (
                  sessions.map((s) => {
                    const isActive = s.id === currentSessionId;
                    const userMsgCount = s.messages.filter(m => m.role === 'user').length;
                    return (
                      <div
                        key={s.id}
                        onClick={() => handleSelectSession(s)}
                        className={`group relative flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                          isActive
                            ? 'bg-violet-500/10 dark:bg-violet-600/15 border-violet-500/50 shadow-sm'
                            : 'bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/5 hover:border-violet-500/30 hover:bg-slate-100 dark:hover:bg-white/[0.05]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            isActive
                              ? 'bg-violet-600 text-white'
                              : 'bg-slate-200 dark:bg-white/5 text-slate-400 group-hover:text-violet-400'
                          }`}>
                            <MessageSquare className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-medium truncate ${
                                isActive ? 'text-violet-600 dark:text-violet-300 font-semibold' : 'text-slate-800 dark:text-slate-200'
                              }`}>
                                {s.title || 'Conversation'}
                              </span>
                              {isActive && (
                                <span className="px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-500 dark:text-violet-400 text-[9px] font-bold uppercase tracking-wider shrink-0">
                                  Active
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
                              <span>{formatSessionDate(s.updatedAt || s.createdAt)}</span>
                              <span>•</span>
                              <span>{userMsgCount} {userMsgCount === 1 ? 'question' : 'questions'}</span>
                            </div>
                          </div>
                        </div>

                        {/* Delete Session Button */}
                        <button
                          type="button"
                          onClick={(e) => handleDeleteSession(e, s.id)}
                          className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition shrink-0 cursor-pointer"
                          title="Delete session"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
  );
}
