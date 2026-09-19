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
      content: `Hello ${user.name}! I am your dedicated AI Trading Mentor. I have access to your trading history in "${account.name}". How can I help you improve your trading today?`
    }
  ]);
  const [usingFallback, setUsingFallback] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
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
        // `fallback` means no model is configured and this reply was scripted
        // from the user's own numbers. Flagged so it is never mistaken for
        // the AI mentor's own analysis.
        if (data.fallback) setUsingFallback(true);
        setMessages(prev => [...prev, { role: 'mentor', content: data.reply }]);
      } else if (data.error) {
        setMessages(prev => [...prev, { role: 'mentor', content: `Error: ${data.error}` }]);
      }
    } catch (e) {
      console.error(e);
      setMessages(prev => [...prev, { role: 'mentor', content: 'Sorry, I am having trouble connecting to the neural network right now. Please try again later.' }]);
    } finally {
      setLoading(false);
    }
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
          <div className="p-2.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <h2 className="dx-section-title flex items-center gap-2">
              AI Mentor
              <span className="text-[10px] bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full uppercase tracking-wider font-extrabold">
                Pro
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Your personal trading psychologist and coach</p>
          </div>
        </div>
      </div>

      {/* Said plainly rather than left to be inferred: without a model
          configured these replies are scripted from the user's own numbers,
          and a Pro subscriber is paying partly for the real thing. */}
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
                  <div className="h-8 w-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                    <UserIcon className="h-4 w-4 text-slate-700 dark:text-slate-300" />
                  </div>
                ) : (
                  <div className="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-500/20">
                    <Brain className="h-4 w-4 text-white" />
                  </div>
                )}
              </div>
              <div 
                className={`p-4 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user' 
                    ? 'bg-indigo-600 text-white rounded-tr-none' 
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-tl-none shadow-sm'
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
                <div className="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-500/20">
                  <Sparkles className="h-4 w-4 text-white animate-pulse" />
                </div>
              </div>
              <div className="p-4 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 rounded-tl-none flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"></div>
                <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
        <form onSubmit={handleSend} className="relative flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your mentor about risk management, psychology, or specific trades..."
            className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-transparent rounded-full py-3.5 pl-5 pr-14 text-sm text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none transition placeholder-slate-400 dark:placeholder-slate-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="absolute right-2 p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full transition-colors disabled:opacity-50 disabled:hover:bg-indigo-600"
          >
            <Send className="h-4 w-4 ml-0.5" />
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
