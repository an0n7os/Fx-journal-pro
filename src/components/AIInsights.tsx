import React, { useState, useRef, useEffect } from 'react';
import { Send, User as UserIcon, Sparkles, AlertTriangle, Zap } from 'lucide-react';
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

function HeyzaAvatar({ size = 'md', pulse = false }: { size?: 'sm' | 'md'; pulse?: boolean }) {
  const dim = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10';
  const font = size === 'sm' ? 'text-[10px]' : 'text-xs';
  return (
    <div className={`${dim} rounded-full flex items-center justify-center shrink-0 relative`}
      style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5, #0ea5e9)' }}>
      <span className={`font-black text-white ${font} tracking-tight select-none`}>Hz</span>
      {pulse && (
        <span className="absolute inset-0 rounded-full animate-ping opacity-30"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }} />
      )}
    </div>
  );
}

export default function AIInsights({ user, account, onUpgradeToPro }: AIInsightsProps) {
  const firstName = user?.name ? user.name.split(' ')[0] : 'Trader';

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'mentor',
      time: getTime(),
      content: `Hey ${firstName}! 👋 I'm **Heyza** — your personal AI trading coach.\n\nI'm here 24/7 to help you sharpen discipline, manage emotions, and build a winning mindset in "${account.name}".\n\nWhether it's FOMO, drawdown stress, setups, or just a rough trading day — I've got you. What's on your mind? 🚀`
    }
  ]);
  const [usingFallback, setUsingFallback] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const quickPrompts = [
    { emoji: '👋', text: 'How are you doing today?' },
    { emoji: '🎯', text: 'How can I improve my win rate?' },
    { emoji: '🧘', text: 'How do I control FOMO?' },
    { emoji: '🛡️', text: 'Check my risk management habits' },
    { emoji: '🔥', text: 'Give me some trading motivation' },
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
        }),
      });
      const data = await response.json();
      if (data.reply) {
        if (data.fallback) setUsingFallback(true);
        setMessages(prev => [...prev, { role: 'mentor', content: data.reply, time: getTime() }]);
      } else if (data.error) {
        setMessages(prev => [...prev, { role: 'mentor', content: `Error: ${data.error}`, time: getTime() }]);
      }
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { role: 'mentor', content: "I'm having a little hiccup right now. Please try again in a moment! 😊", time: getTime() }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) { inputRef.current?.focus(); return; }
    sendQuery(input);
  };

  if (!user.isPro) {
    return (
      <ProFeaturePanel
        title="Meet Heyza — Your Personal AI Trading Coach"
        blurb="Chat with Heyza, an AI that reads your own journal, spots the emotional triggers behind your losing trades, and coaches you on risk and discipline."
        onUpgrade={onUpgradeToPro}
      />
    );
  }

  return (
    <div
      id="ai-mentor-card"
      className="flex flex-col overflow-hidden"
      style={{
        height: '75vh',
        maxHeight: '780px',
        minHeight: '520px',
        background: 'linear-gradient(160deg, #07091a 0%, #0d1128 60%, #0a0f20 100%)',
        border: '1px solid rgba(99,102,241,0.18)',
        borderRadius: '20px',
        boxShadow: '0 0 60px rgba(99,102,241,0.08), 0 24px 48px rgba(0,0,0,0.4)',
      }}
    >
      {/* HEADER */}
      <div
        className="shrink-0 flex items-center justify-between px-5 py-3.5"
        style={{
          background: 'linear-gradient(90deg, rgba(124,58,237,0.12), rgba(79,70,229,0.08))',
          borderBottom: '1px solid rgba(99,102,241,0.15)',
        }}
      >
        <div className="flex items-center gap-3">
          <HeyzaAvatar size="md" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-base tracking-tight">Heyza</span>
              <span
                className="text-[9px] font-extrabold uppercase tracking-widest text-white px-1.5 py-0.5 rounded-full"
                style={{ background: 'linear-gradient(90deg,#7c3aed,#4f46e5)' }}
              >
                AI
              </span>
              <span
                className="text-[9px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded-full"
                style={{ background: 'linear-gradient(90deg,#f59e0b,#ef4444)', color: '#fff' }}
              >
                PRO
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Your personal trading coach &amp; mindset guide</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/60 animate-pulse" />
          <span className="text-[10px] text-emerald-400 font-medium">Online</span>
        </div>
      </div>

      {/* FALLBACK WARNING */}
      {usingFallback && (
        <div
          className="shrink-0 flex items-center gap-2.5 px-5 py-2.5"
          style={{ background: 'rgba(245,158,11,0.07)', borderBottom: '1px solid rgba(245,158,11,0.15)' }}
        >
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <p className="text-[11px] text-amber-300/80">
            <strong className="text-amber-300">Basic mode active.</strong> AI model unavailable — replies use your trade statistics.
          </p>
        </div>
      )}

      {/* MESSAGES */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5 custom-scrollbar">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2.5`}>
            {msg.role === 'mentor' && <HeyzaAvatar size="sm" />}

            <div className={`flex flex-col gap-1 max-w-[78%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div
                className="px-4 py-3 text-sm leading-relaxed"
                style={msg.role === 'user' ? {
                  background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                  color: '#fff',
                  borderRadius: '18px 18px 4px 18px',
                  boxShadow: '0 4px 20px rgba(99,102,241,0.25)',
                } : {
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: '#cbd5e1',
                  borderRadius: '4px 18px 18px 18px',
                  backdropFilter: 'blur(8px)',
                }}
                dangerouslySetInnerHTML={{
                  __html: msg.content
                    .replace(/\n/g, '<br/>')
                    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#a5b4fc">$1</strong>')
                }}
              />
              <span className="text-[10px] text-slate-600 px-1">{msg.time}</span>
            </div>

            {msg.role === 'user' && (
              <div className="h-8 w-8 rounded-full bg-slate-700/80 border border-slate-600/50 flex items-center justify-center shrink-0">
                <UserIcon className="h-4 w-4 text-slate-300" />
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div className="flex justify-start gap-2.5">
            <HeyzaAvatar size="sm" pulse />
            <div
              className="px-4 py-3 flex items-center gap-1.5"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '4px 18px 18px 18px',
              }}
            >
              {[0, 150, 300].map(delay => (
                <div
                  key={delay}
                  className="h-2 w-2 rounded-full bg-indigo-400 animate-bounce"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* QUICK PROMPTS */}
      <div
        className="shrink-0 px-4 py-2.5 flex items-center gap-2 overflow-x-auto no-scrollbar"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(7,9,26,0.8)' }}
      >
        <Zap className="h-3.5 w-3.5 text-violet-400 shrink-0" />
        {quickPrompts.map((p, i) => (
          <button
            key={i}
            type="button"
            onClick={() => sendQuery(`${p.emoji} ${p.text}`)}
            disabled={loading}
            className="whitespace-nowrap text-[11px] px-3 py-1.5 rounded-full transition-all duration-150 shrink-0 font-medium disabled:opacity-40"
            style={{
              background: 'rgba(99,102,241,0.08)',
              border: '1px solid rgba(99,102,241,0.2)',
              color: '#a5b4fc',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.2)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.5)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.08)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.2)';
            }}
          >
            {p.emoji} {p.text}
          </button>
        ))}
      </div>

      {/* INPUT */}
      <div
        className="shrink-0 px-4 pb-4 pt-3"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(7,9,26,0.95)' }}
      >
        <form onSubmit={handleSend} className="flex items-center gap-3">
          <div className="flex-1">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask Heyza anything about mindset, risk, setups…"
              disabled={loading}
              className="w-full py-3 pl-4 pr-4 text-sm rounded-2xl focus:outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(99,102,241,0.25)',
                color: '#e2e8f0',
                caretColor: '#818cf8',
              }}
              onFocus={e => {
                e.currentTarget.style.borderColor = 'rgba(99,102,241,0.6)';
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.1)';
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 active:scale-95 disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}
            aria-label="Send message"
          >
            <Send className="h-4 w-4 text-white ml-0.5" />
          </button>
        </form>
        <p className="text-center text-[10px] text-slate-600 mt-2.5 flex items-center justify-center gap-1">
          <AlertTriangle className="h-2.5 w-2.5" />
          Heyza focuses on trading psychology &amp; mindset. Not financial advice.
        </p>
      </div>
    </div>
  );
}
