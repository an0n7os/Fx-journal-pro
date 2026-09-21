import React, { useState, useRef, useEffect } from 'react';
import { Brain, Send, User as UserIcon, Lock, Sparkles, HelpCircle, AlertTriangle } from 'lucide-react';
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
}

export default function AIInsights({ user, account, onUpgradeToPro }: AIInsightsProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'mentor',
      content: `Hey ${user?.name ? user.name.split(' ')[0] : 'there'}! 👋 Welcome! 😊\n\nI'm your personal AI Trading Mentor & Coach. Think of me as your 24/7 trading buddy, mindset coach, and risk guide in "${account.name}".\n\nWhether you want to chat about market discipline, review your setups, talk through tough emotions like fear or FOMO, or just discuss how your trading day went — I'm right here with you! What's on your mind today? 🚀`
    }
  ]);
  const [usingFallback, setUsingFallback] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const quickPrompts = [
    "👋 Hey! How are you doing today?",
    "🎯 How can I improve my win rate?",
    "🧘 How do I control FOMO?",
    "🛡️ Check my risk management habits",
    "🔥 I need some trading motivation"
  ];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendQuery = async (queryText: string) => {
    if (!queryText.trim() || loading) return;

    const userMsg = queryText.trim();
    setInput('');
    const newMessages: Message[] = [...messages, { role: 'user', content: userMsg }];
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
          ...(storedEmail ? { 'x-auth-email': storedEmail } : {})
        },
        body: JSON.stringify({ 
          accountId: account.id,
          messages: newMessages.slice(-10) // Send the last 10 messages for context
        })
      });
      
      const data = await response.json();
      
      if (data.reply) {
        if (data.fallback) setUsingFallback(true);
        setMessages(prev => [...prev, { role: 'mentor', content: data.reply }]);
      } else if (data.error) {
        setMessages(prev => [...prev, { role: 'mentor', content: `Error: ${data.error}` }]);
      }
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { role: 'mentor', content: "Hey! I'm having a little hiccup connecting to the neural network right now. Please give it another try in a moment! 😊" }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) {
      inputRef.current?.focus();
      return;
    }
    sendQuery(input);
  };

  if (!user.isPro) {
    return (
      <ProFeaturePanel
        title="Personalized AI Trading Mentor"
        blurb="Chat with a mentor that reads your own journal, spots the emotional triggers behind your losing trades, and answers what you ask about risk and discipline."
        onUpgrade={onUpgradeToPro}
      />
    );
  }

  return (
    <div id="ai-mentor-card" className="dx-panel shadow-xl shadow-slate-200/50 dark:shadow-none overflow-hidden flex flex-col h-[650px] max-h-[80vh]">
      {/* Header */}
      <div className="flex items-center justify-between bg-slate-50 dark:bg-white/[0.02] border-b border-slate-200 dark:border-white/[0.07] px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-tr from-violet-600 to-indigo-600 text-white rounded-xl shadow-md shadow-indigo-500/20">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <h2 className="dx-section-title flex items-center gap-2">
              AI Mentor
              <span className="text-[10px] bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-2 py-0.5 rounded-full uppercase tracking-wider font-extrabold shadow-sm">
                Pro
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Your warm personal trading coach, buddy & psychologist</p>
          </div>
        </div>
      </div>

      {usingFallback && (
        <div className="flex items-start gap-2.5 border-b border-amber-500/25 bg-amber-500/[0.08] px-6 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500 mt-px" />
          <p className="text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-200">
            <strong className="font-bold">Basic replies.</strong> The AI model is not connected on this
            deployment, so answers are generated from your own trade statistics rather than by the mentor.
          </p>
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50 dark:bg-slate-950/50">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex gap-3 max-w-[85%] md:max-w-[75%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className="flex-shrink-0 mt-1">
                {msg.role === 'user' ? (
                  <div className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center shadow-sm">
                    <UserIcon className="h-4 w-4 text-slate-700 dark:text-slate-300" />
                  </div>
                ) : (
                  <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center shadow-md shadow-indigo-500/30">
                    <Brain className="h-4 w-4 text-white" />
                  </div>
                )}
              </div>
              <div 
                className={`p-4 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user' 
                    ? 'user-chat-bubble bg-gradient-to-r from-violet-600 via-indigo-600 to-indigo-700 text-white rounded-tr-none shadow-md shadow-indigo-500/25' 
                    : 'bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 text-slate-800 dark:text-slate-200 rounded-tl-none shadow-sm'
                }`}
                style={{ whiteSpace: 'pre-wrap' }}
              >
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="flex gap-3 max-w-[85%]">
              <div className="flex-shrink-0 mt-1">
                <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center shadow-md shadow-indigo-500/30">
                  <Sparkles className="h-4 w-4 text-white animate-pulse" />
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 rounded-tl-none flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce"></div>
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested quick chips */}
      <div className="px-4 py-2 bg-slate-100/80 dark:bg-slate-900/60 border-t border-slate-200/80 dark:border-slate-800 flex items-center gap-2 overflow-x-auto no-scrollbar">
        <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 whitespace-nowrap flex items-center gap-1">
          <Sparkles className="h-3 w-3 text-indigo-500" /> Ideas:
        </span>
        {quickPrompts.map((prompt, pIdx) => (
          <button
            key={pIdx}
            type="button"
            onClick={() => sendQuery(prompt)}
            disabled={loading}
            className="text-[11.5px] px-3 py-1 rounded-full whitespace-nowrap bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/40 transition-all duration-150 cursor-pointer shadow-2xs"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
        <form onSubmit={handleSend} className="relative flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your mentor anything about mindset, risk, FOMO, or setups..."
            className="w-full bg-slate-100 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/80 rounded-full py-3.5 pl-5 pr-14 text-sm text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition placeholder-slate-400 dark:placeholder-slate-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading}
            aria-label="Send message"
            className="ai-send-btn absolute right-2 p-2.5 rounded-full transition-all duration-200 flex items-center justify-center text-white cursor-pointer active:scale-95"
            title="Send message"
          >
            <Send className="h-4 w-4 ml-0.5 text-white" />
          </button>
        </form>
        <div className="text-center mt-2.5">
          <p className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center justify-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            AI Mentor focuses exclusively on trading psychology and risk control. No financial guarantees provided.
          </p>
        </div>
      </div>
    </div>
  );
}
