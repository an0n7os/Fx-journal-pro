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
      return `<h4 class="text-sm font-semibold text-purple-200 mt-2 mb-1">${l.slice(4)}</h4>`;
    }
    if (l.startsWith('## ')) {
      return `<h3 class="text-base font-semibold text-white mt-2.5 mb-1">${l.slice(3)}</h3>`;
    }
    if (l.startsWith('# ')) {
      return `<h2 class="text-lg font-semibold text-white mt-3 mb-1.5">${l.slice(2)}</h2>`;
    }

    if (l.startsWith('• ') || l.startsWith('- ') || l.startsWith('* ')) {
      return `<div class="flex items-start gap-2 my-1 text-neutral-300 text-[13px] leading-relaxed"><span class="text-purple-400 font-bold shrink-0 mt-0.5">•</span><span>${l.slice(2)}</span></div>`;
    }

    const numMatch = l.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      return `<div class="flex items-start gap-2 my-1 text-neutral-300 text-[13px] leading-relaxed"><span class="text-purple-400 font-medium shrink-0 text-xs mt-0.5">${numMatch[1]}.</span><span>${numMatch[2]}</span></div>`;
    }

    return `<p class="my-0.5 text-neutral-300 text-[13px] leading-relaxed">${l}</p>`;
  });

  return formattedLines
    .join('')
    .replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-medium">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em class="text-purple-200">$1</em>');
}

/**
 * Animated 3D Holographic Particle Wave Sphere
 * Renders the exact organic particle ripple mesh seen in the reference screenshot
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
      t += 0.02;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const baseR = 52;

      const numLines = 32;
      for (let i = 0; i < numLines; i++) {
        const phi = (i / numLines) * Math.PI;
        const progress = i / numLines;

        // Gradient from Cyan (#38bdf8) at top to Violet/Magenta (#ec4899) at bottom
        const r = Math.floor(56 + progress * (236 - 56));
        const g = Math.floor(189 - progress * (189 - 72));
        const b = Math.floor(248 - progress * (248 - 153));
        const alpha = 0.38 + Math.sin(phi) * 0.52;

        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.lineWidth = 1.15;
        ctx.setLineDash([1.8, 2.6]);

        ctx.beginPath();
        const numPoints = 46;
        for (let j = 0; j <= numPoints; j++) {
          const theta = (j / numPoints) * 2 * Math.PI;
          const wave = Math.sin(theta * 3.5 + t + phi * 2.5) * 6 + Math.cos(phi * 4.5 - t * 1.3) * 5;
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
    <div className="relative flex items-center justify-center my-0.5 md:my-0">
      {/* Background ambient radial glow */}
      <div
        className="absolute w-28 h-28 sm:w-36 sm:h-36 md:w-48 md:h-48 rounded-full blur-3xl opacity-60 pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(56, 189, 248, 0.5) 0%, rgba(168, 85, 247, 0.4) 45%, rgba(236, 72, 153, 0.25) 75%, transparent 90%)',
        }}
      />
      <canvas
        ref={canvasRef}
        width={200}
        height={200}
        className="w-24 h-24 sm:w-28 sm:h-28 md:w-44 md:h-44 relative z-10 cursor-pointer drop-shadow-[0_0_24px_rgba(168,85,247,0.55)] transition-transform duration-300"
      />
    </div>
  );
};

export default function AIInsights({ user, account, onUpgradeToPro }: AIInsightsProps) {
  const firstName = user?.name ? user.name.split(' ')[0] : 'human';

  const initialGreeting: Message = {
    role: 'mentor',
    time: getTime(),
    content: `Hello there, ${firstName}! How can I assist you with your trading on **${account.name}** today?`,
  };

  const [messages, setMessages] = useState<Message[]>([initialGreeting]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFindInModal, setShowFindInModal] = useState(false);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [findScope, setFindScope] = useState<'account' | 'all' | 'today'>('account');
  const [activeModel, setActiveModel] = useState('Google Gemma 4 (Free)');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Suggested Prompts for Mobile and Desktop
  const suggestedPrompts = [
    {
      title: "Trade & Win Rate Review",
      icon: "📊",
      text: "Review my recent trades and win rate. How is my discipline holding up?",
    },
    {
      title: "Psychology & Emotional Audit",
      icon: "🧠",
      text: "Analyze my trading psychology and detect emotional triggers behind losing trades.",
    },
    {
      title: "Risk & Drawdown Audit",
      icon: "🛡️",
      text: "Audit my risk-to-reward ratio, lot sizing, and drawdown rules.",
    },
    {
      title: "Session Preparation",
      icon: "⚡",
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
        title="Meet Your Personal AI Assistant"
        blurb="Chat with an advanced AI assistant that reads your trading data, audits discipline, and helps you optimize your trading strategy."
        onUpgrade={onUpgradeToPro}
      />
    );
  }

  const isHeroMode = messages.length <= 1;

  return (
    <div className="w-full flex justify-center py-2 sm:py-6 px-1.5 sm:px-4">
      {/* ── Main Chat Window (Balanced Landscape on PC, Portrait on Mobile) ── */}
      <div
        id="ai-assistant-card"
        className="relative w-full max-w-[440px] md:max-w-4xl lg:max-w-5xl rounded-[24px] md:rounded-[28px] overflow-hidden border border-[#242428] flex flex-col justify-between transition-all duration-300"
        style={{
          minHeight: '480px',
          height: 'min(640px, calc(100dvh - 120px))',
          background: '#131315',
          boxShadow: '0 30px 70px -15px rgba(0, 0, 0, 0.95), 0 0 35px -10px rgba(168, 85, 247, 0.12)',
        }}
      >
        {/* ── Top Header Bar ── */}
        <div className="flex items-center justify-between px-5 md:px-7 pt-4 pb-2 shrink-0 bg-transparent">
          {/* Left: Sparkle + Title + Active Account Badge on PC */}
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-purple-400" />
            <span className="text-white font-medium text-[14px] tracking-tight">AI Assistant</span>
            <span className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#1c1c20] border border-white/5 text-[11px] text-neutral-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
              <span>{account.name}</span>
            </span>
          </div>

          {/* Right: Actions (More, Clock, Close) */}
          <div className="flex items-center gap-3.5 text-neutral-400">
            <button
              onClick={() => setShowModelModal(prev => !prev)}
              className="hover:text-white transition cursor-pointer p-1"
              title="Model Settings"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowHistoryModal(prev => !prev)}
              className="hover:text-white transition cursor-pointer p-1"
              title="Chat History / Sessions"
            >
              <Clock className="w-4 h-4" />
            </button>
            <button
              onClick={handleResetChat}
              className="hover:text-white transition cursor-pointer p-1"
              title="Reset Chat"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Middle Body: Hero Mesh or Chat Stream ── */}
        <div className="flex-1 overflow-y-auto px-4 md:px-7 py-2 custom-scrollbar flex flex-col min-h-0">
          {isHeroMode ? (
            /* HERO MODE: Symmetrically Centered on Desktop & Mobile */
            <div className="flex flex-col items-center justify-center my-auto py-2 text-center animate-fadeIn w-full max-w-4xl mx-auto space-y-2.5 md:space-y-3.5">
              {/* Centered Holographic Mesh Orb */}
              <div className="relative flex items-center justify-center">
                <HolographicMeshSphere />
              </div>

              {/* Centered Greetings */}
              <div className="space-y-0.5 md:space-y-1">
                <h2 className="text-[20px] sm:text-[24px] md:text-[28px] font-bold text-white tracking-tight leading-snug">
                  Hello there, human!
                </h2>
                <h3 className="text-[20px] sm:text-[24px] md:text-[28px] font-bold text-white tracking-tight leading-snug">
                  How can I assist you?
                </h3>
              </div>

              {/* MOBILE: Sleek chat suggestion bubbles matching reference mockup */}
              <div className="flex md:hidden flex-col gap-2 w-full max-w-[340px] pt-1">
                <button
                  type="button"
                  onClick={() => sendQuery("Review my recent trades and win rate. How is my discipline holding up?")}
                  className="rounded-2xl rounded-tr-md bg-[#1f1f25] hover:bg-[#282830] active:scale-[0.98] border border-white/[0.08] p-3 text-left text-[12.5px] text-neutral-300 leading-relaxed shadow-sm transition cursor-pointer"
                >
                  Review my recent trades and win rate. How is my discipline holding up?
                </button>
                <button
                  type="button"
                  onClick={() => sendQuery("Analyze my trading psychology and detect emotional triggers behind losing trades.")}
                  className="rounded-2xl rounded-tr-md bg-[#1f1f25] hover:bg-[#282830] active:scale-[0.98] border border-white/[0.08] p-3 text-left text-[12.5px] text-neutral-300 leading-relaxed shadow-sm transition cursor-pointer"
                >
                  Analyze my trading psychology and detect emotional triggers behind losing trades.
                </button>
              </div>

              {/* DESKTOP: Centered 4-col row */}
              <div className="hidden md:grid md:grid-cols-4 gap-2.5 w-full pt-2">
                {suggestedPrompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    onClick={() => sendQuery(prompt.text)}
                    className="text-left p-3.5 rounded-[18px] bg-[#1a1a20] hover:bg-[#23232b] active:scale-[0.98] border border-white/[0.07] hover:border-purple-500/40 hover:shadow-[0_8px_25px_-5px_rgba(168,85,247,0.2)] transition-all duration-200 cursor-pointer group flex flex-col justify-between shadow-sm"
                    style={{ minHeight: '94px' }}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-6 h-6 rounded-md bg-[#252530] flex items-center justify-center text-sm group-hover:scale-105 transition shrink-0">
                        {prompt.icon}
                      </span>
                      <span className="text-xs font-semibold text-neutral-100 group-hover:text-purple-300 transition line-clamp-1">
                        {prompt.title}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-400 group-hover:text-neutral-300 leading-relaxed line-clamp-2">
                      {prompt.text}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* CONVERSATION STREAM MODE (Spacious on PC, Compact on Mobile) */
            <div className="space-y-3.5 w-full max-w-3xl mx-auto pt-2 animate-fadeIn">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}
                >
                  {msg.role === 'mentor' && (
                    <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-purple-500 via-pink-500 to-cyan-400 shrink-0 mt-1 flex items-center justify-center text-[9px] font-bold text-white shadow-sm">
                      AI
                    </div>
                  )}

                  <div className={`flex flex-col gap-1 max-w-[88%] md:max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`px-4 py-3 rounded-2xl text-[13px] leading-relaxed shadow-sm ${
                        msg.role === 'user'
                          ? 'bg-[#222225] text-white border border-white/5'
                          : 'bg-[#1c1c1f] text-neutral-200 border border-white/5'
                      }`}
                      dangerouslySetInnerHTML={{
                        __html: formatMarkdown(msg.content),
                      }}
                    />
                    <span className="text-[9px] text-neutral-500 px-1">{msg.time}</span>
                  </div>

                  {msg.role === 'user' && (
                    <div className="w-6 h-6 rounded-full bg-neutral-800 border border-white/10 flex items-center justify-center shrink-0 mt-1">
                      <UserIcon className="w-3 h-3 text-neutral-300" />
                    </div>
                  )}
                </div>
              ))}

              {/* Typing indicator */}
              {loading && (
                <div className="flex justify-start gap-2 items-center">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-purple-500 via-pink-500 to-cyan-400 shrink-0 flex items-center justify-center text-[9px] font-bold text-white">
                    AI
                  </div>
                  <div className="px-3.5 py-2 rounded-2xl bg-[#1c1c1f] border border-white/5 flex items-center gap-1.5">
                    {[0, 150, 300].map(delay => (
                      <div
                        key={delay}
                        className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce"
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

        {/* ── Bottom Section: Action Pills + Pill Input Bar (Full Width Landscape on PC) ── */}
        <div className="shrink-0 px-3 md:px-7 pb-3 md:pb-4 pt-1 bg-transparent space-y-2 md:space-y-2.5">
          {/* Action Pills Row: [Find in ⌵] [AI Assistant ⌵] [↺] */}
          <div className="flex items-center gap-1.5 md:gap-2">
            {/* Pill 1: Find in ⌵ */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowFindInModal(prev => !prev);
                  setShowModelModal(false);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 md:px-3 md:py-1.5 rounded-full bg-[#1e1e22] hover:bg-[#27272c] border border-[#2c2c32] text-[11px] md:text-xs text-neutral-300 hover:text-white transition cursor-pointer"
              >
                <Search className="w-3 md:w-3.5 h-3 md:h-3.5 text-neutral-400" />
                <span>Find in</span>
                <ChevronDown className="w-2.5 md:w-3 h-2.5 md:h-3 text-neutral-400" />
              </button>

              {showFindInModal && (
                <div className="absolute bottom-9 left-0 w-44 rounded-xl bg-[#1c1c20] border border-[#2d2d33] p-1.5 shadow-xl z-30 text-xs animate-fadeIn space-y-1">
                  <button
                    onClick={() => { setFindScope('account'); setShowFindInModal(false); }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg transition ${findScope === 'account' ? 'bg-purple-600/30 text-purple-200 font-medium' : 'text-neutral-300 hover:bg-neutral-800'}`}
                  >
                    Current: {account.name}
                  </button>
                  <button
                    onClick={() => { setFindScope('today'); setShowFindInModal(false); }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg transition ${findScope === 'today' ? 'bg-purple-600/30 text-purple-200 font-medium' : 'text-neutral-300 hover:bg-neutral-800'}`}
                  >
                    Today's Trades
                  </button>
                  <button
                    onClick={() => { setFindScope('all'); setShowFindInModal(false); }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg transition ${findScope === 'all' ? 'bg-purple-600/30 text-purple-200 font-medium' : 'text-neutral-300 hover:bg-neutral-800'}`}
                  >
                    All Accounts
                  </button>
                </div>
              )}
            </div>

            {/* Pill 2: [avatar] AI Assistant ⌵ */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowModelModal(prev => !prev);
                  setShowFindInModal(false);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 md:px-3 md:py-1.5 rounded-full bg-[#1e1e22] hover:bg-[#27272c] border border-[#2c2c32] text-[11px] md:text-xs text-neutral-300 hover:text-white transition cursor-pointer"
              >
                <div className="w-3 md:w-3.5 h-3 md:h-3.5 rounded-full bg-gradient-to-tr from-purple-500 via-pink-500 to-cyan-400 shrink-0" />
                <span className="font-medium">AI Assistant</span>
                <ChevronDown className="w-2.5 md:w-3 h-2.5 md:h-3 text-neutral-400" />
              </button>

              {showModelModal && (
                <div className="absolute bottom-9 left-0 w-52 rounded-xl bg-[#1c1c20] border border-[#2d2d33] p-1.5 shadow-xl z-30 text-xs animate-fadeIn space-y-1">
                  <div className="px-2.5 py-1 text-[11px] text-neutral-500 font-medium uppercase tracking-wider">
                    Select Model
                  </div>
                  <button
                    onClick={() => { setActiveModel('Google Gemma 4 (Free)'); setShowModelModal(false); }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg transition ${activeModel.includes('Gemma') ? 'bg-purple-600/30 text-purple-200 font-medium' : 'text-neutral-300 hover:bg-neutral-800'}`}
                  >
                    Google Gemma 4 (Free)
                  </button>
                  <button
                    onClick={() => { setActiveModel('OpenAI GPT-4o'); setShowModelModal(false); }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg transition ${activeModel.includes('GPT') ? 'bg-purple-600/30 text-purple-200 font-medium' : 'text-neutral-300 hover:bg-neutral-800'}`}
                  >
                    OpenAI GPT-4o (Fallback)
                  </button>
                </div>
              )}
            </div>

            {/* Pill 3: Undo / Reset ↺ */}
            <button
              type="button"
              onClick={handleResetChat}
              className="w-6 h-6 md:w-7 md:h-7 rounded-full bg-[#1e1e22] hover:bg-[#27272c] border border-[#2c2c32] text-neutral-400 hover:text-white flex items-center justify-center transition cursor-pointer"
              title="Reset Chat"
            >
              <RotateCcw className="w-3 md:w-3.5 h-3 md:h-3.5" />
            </button>
          </div>

          {/* Pill Input Bar: Single Seamless Pill Bar (No Inner Box) */}
          <div className="flex items-center gap-2 bg-[#1b1b1e] border border-[#2e2e36] focus-within:border-purple-400/50 rounded-full pl-4 pr-1.5 py-1 md:pl-5 md:pr-2 md:py-1.5 transition-all duration-200">
            <style>{`
              html.dark input.chat-clean-input,
              html.dark input.chat-clean-input:focus,
              html.dark input.chat-clean-input:focus-visible,
              html.dark input.chat-clean-input:hover,
              html.dark input.chat-clean-input:active,
              .chat-clean-input,
              .chat-clean-input:focus,
              .chat-clean-input:focus-visible,
              .chat-clean-input:hover,
              .chat-clean-input:active {
                border: none !important;
                border-width: 0 !important;
                border-color: transparent !important;
                outline: none !important;
                box-shadow: none !important;
                -webkit-box-shadow: none !important;
                background: transparent !important;
                background-color: transparent !important;
              }
            `}</style>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask AI anything..."
              disabled={loading}
              style={{
                background: 'transparent',
                backgroundColor: 'transparent',
                border: 'none',
                borderWidth: 0,
                outline: 'none',
                boxShadow: 'none',
              }}
              className="chat-clean-input flex-1 text-[13px] md:text-[13.5px] text-neutral-100 placeholder-neutral-500 leading-relaxed min-w-0"
            />

            <div className="flex items-center gap-1.5 md:gap-2 shrink-0 pr-0.5">
              {/* @ mention button */}
              <button
                type="button"
                onClick={() => setInput(prev => `${prev}@${account.name} `)}
                className="w-7 h-7 md:w-8 md:h-8 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 active:scale-95 flex items-center justify-center transition cursor-pointer"
                title="Tag account"
              >
                <AtSign className="w-3.5 md:w-4 h-3.5 md:h-4" />
              </button>

              {/* Up arrow send button with our signature violet theme color */}
              <button
                type="button"
                onClick={() => { if (input.trim()) sendQuery(input); }}
                className={`w-7 h-7 md:w-8 md:h-8 rounded-full flex items-center justify-center text-white transition-all duration-200 cursor-pointer shrink-0 active:scale-95 ${
                  input.trim()
                    ? 'bg-[#7c3aed] hover:bg-[#8b5cf6] shadow-[0_0_16px_rgba(124,58,237,0.65)]'
                    : 'bg-[#6d28d9] hover:bg-[#7c3aed] shadow-[0_0_10px_rgba(109,40,217,0.4)]'
                }`}
                aria-label="Send"
              >
                <ArrowUp className="w-3.5 md:w-4 h-3.5 md:h-4 stroke-[2.8]" />
              </button>
            </div>
          </div>
        </div>

        {/* History Modal */}
        {showHistoryModal && (
          <div className="absolute inset-0 bg-[#131315]/95 backdrop-blur-md p-6 z-40 flex flex-col justify-between animate-fadeIn">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-[#25252a]">
                <h3 className="text-sm font-semibold text-white">Chat Sessions</h3>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  className="text-neutral-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="py-4 space-y-2">
                <div className="p-3 rounded-xl bg-[#1c1c20] border border-white/5 text-xs text-neutral-300">
                  <div className="font-medium text-white mb-1">Active Session</div>
                  <div className="text-neutral-400 line-clamp-1">{messages[messages.length - 1]?.content || 'Started'}</div>
                </div>
              </div>
            </div>

            <button
              onClick={handleResetChat}
              className="w-full py-2.5 rounded-full bg-[#252529] hover:bg-[#2e2e34] text-xs font-medium text-white transition flex items-center justify-center gap-1.5"
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
