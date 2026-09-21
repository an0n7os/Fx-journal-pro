import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FileText, Star, Archive, Trash2, Folder, Tag as TagIcon, Plus, ChevronDown,
  Search, Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare, Quote, Code, Minus, Save, Sparkles,
  ArrowLeft, Share2, Download, RefreshCw, X, Check, Smile, AlertCircle
} from 'lucide-react';
import { NotebookNote, User, TradingAccount } from '../types';

interface NotebookTabProps {
  user?: User;
  account?: TradingAccount;
}

// Built-in starter trading templates
const TEMPLATES: Record<string, { title: string; folder: string; tags: string[]; content: string; mood: NotebookNote['mood'] }> = {
  blank: {
    title: 'Untitled Note',
    folder: 'Daily Journal',
    tags: ['review'],
    mood: 'Disciplined',
    content: ''
  },
  preMarket: {
    title: `Pre-Market Plan – ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    folder: 'Daily Journal',
    tags: ['setup', 'review'],
    mood: 'Disciplined',
    content: `## 🌅 Pre-Market Preparation

### 1. Market Context & Bias
- **EUR/USD**: Neutral / waiting for London open liquidity sweep
- **XAU/USD (Gold)**: Bullish above key support
- **US30 / NAS100**: Watching NY session open reaction

### 2. High-Impact News / Catalysts Today
- [ ] Check ForexFactory / Economic Calendar for Red Folders
- [ ] No entries 15 mins before or after high-impact events

### 3. Key Levels & Watchlist
- **Key Support**: 
- **Key Resistance**: 
- **Setup Type**: Pullback to Order Block / Trend continuation

### 4. Risk & Psychology Rules
- [ ] Maximum Risk Today: 1% of total equity
- [ ] Max Trades Allowed: 2 trades max
- [ ] Stop-Loss hard placed immediately on execution
- [ ] Walk away if 2 consecutive stop-outs occur
`
  },
  postMarket: {
    title: `Daily Review – ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    folder: 'Daily Journal',
    tags: ['review', 'psychology'],
    mood: 'Calm',
    content: `## 🌆 Post-Market Daily Review

### 1. Execution & Discipline
- **Execution Score (1-10)**: 8/10
- **Did I follow my trading rules?**: Yes
- **Did I wait for confirmed candle closures?**: Yes

### 2. What Went Well Today?
- Waited patiently for the London session setup.
- Held winner to target instead of closing early in panic.

### 3. Mistakes & Weaknesses
- Sized slightly too early before liquidity sweep was finalized.

### 4. Psychological State
- Feeling calm and composed. No urge to revenge trade.

### 5. One Lesson For Tomorrow
> *"Consistency comes from repeatable process, not individual trade outcomes."*
`
  },
  psychology: {
    title: `Psychology & Mindset Check – ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
    folder: 'Psychology',
    tags: ['psychology'],
    mood: 'Calm',
    content: `## 🧠 Trader Mindset & Emotional Audit

### 1. Current Emotional Pulse
- **Energy Level**: High / Focused
- **Stress / Anxiety**: Low
- **Sleep Quality**: 7+ hours

### 2. Emotional Triggers Encountered
- [ ] FOMO (Fear of missing out on big candles)
- [ ] Revenge trading urge after a loss
- [ ] Greed (moving take profit higher prematurely)
- [ ] Fear of loss (hesitating to pull the trigger on valid setups)

### 3. Reset Routine
1. Step away from charts for 15 minutes.
2. 5 deep diaphragmatic breaths.
3. Remember: Capital preservation is priority #1.
`
  },
  weeklyAudit: {
    title: `Weekly Performance Audit – Week ${Math.ceil(new Date().getDate() / 7)}`,
    folder: 'Weekly Reviews',
    tags: ['review', 'setup'],
    mood: 'Confident',
    content: `## 📊 Weekly Performance Audit

### 1. Core Metrics
- **Total Trades Taken**: 
- **Win Rate**: %
- **Net P&L ($ / %)**: 
- **Average Risk:Reward**: 

### 2. Best Trade of the Week
- Pair & Setup: 
- Why it worked: Flawless execution on 15m confluence with higher timeframe trend.

### 3. Worst Trade of the Week
- What caused the error: Impatience / entering during consolidation.

### 4. Strategic Adjustments for Next Week
- Focus solely on A+ setups during London & New York session crossovers.
`
  }
};

const DEFAULT_FOLDERS = [
  'Daily Journal',
  'Trading Plans',
  'Weekly Reviews',
  'Psychology',
  'Playbook & Setups'
];

const DEFAULT_TAGS = [
  'setup',
  'psychology',
  'review',
  'discipline',
  'risk-management',
  'breakout'
];

export default function NotebookTab({ user }: NotebookTabProps) {
  const storagePrefix = `fx_notebook_${user?.id || 'default'}`;

  // State: Notes
  const [notes, setNotes] = useState<NotebookNote[]>(() => {
    try {
      const saved = localStorage.getItem(`${storagePrefix}_notes`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (_) {}
    return [];
  });

  // State: Folders
  const [folders, setFolders] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`${storagePrefix}_folders`);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return DEFAULT_FOLDERS;
  });

  // Navigation Filter
  // filterType: 'all' | 'favourites' | 'archived' | 'trash' | 'folder' | 'tag'
  const [filterType, setFilterType] = useState<string>('folder');
  const [selectedFolder, setSelectedFolder] = useState<string>('Daily Journal');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Selected note for editing
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  // Template dropdown menu
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const templateMenuRef = useRef<HTMLDivElement>(null);

  // New folder dialog
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // New tag dialog
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [customTags, setCustomTags] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`${storagePrefix}_tags`);
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return DEFAULT_TAGS;
  });

  // Mobile view toggle (list vs editor)
  const [mobileShowEditor, setMobileShowEditor] = useState(false);

  // Save indicator
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const saveTimeoutRef = useRef<any>(null);

  // Textarea ref for rich formatting insertions
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Persist notes
  useEffect(() => {
    try {
      localStorage.setItem(`${storagePrefix}_notes`, JSON.stringify(notes));
    } catch (_) {}
  }, [notes, storagePrefix]);

  // Persist folders
  useEffect(() => {
    try {
      localStorage.setItem(`${storagePrefix}_folders`, JSON.stringify(folders));
    } catch (_) {}
  }, [folders, storagePrefix]);

  // Persist tags
  useEffect(() => {
    try {
      localStorage.setItem(`${storagePrefix}_tags`, JSON.stringify(customTags));
    } catch (_) {}
  }, [customTags, storagePrefix]);

  // Close template menu on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (templateMenuRef.current && !templateMenuRef.current.contains(event.target as Node)) {
        setTemplateMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Compute folder counts
  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    folders.forEach(f => { counts[f] = 0; });
    notes.forEach(n => {
      if (!n.isTrash && !n.isArchived) {
        counts[n.folder] = (counts[n.folder] || 0) + 1;
      }
    });
    return counts;
  }, [notes, folders]);

  // Compute filter counts
  const navCounts = useMemo(() => {
    let all = 0;
    let favourites = 0;
    let archived = 0;
    let trash = 0;

    notes.forEach(n => {
      if (n.isTrash) {
        trash++;
      } else if (n.isArchived) {
        archived++;
      } else {
        all++;
        if (n.isFavourite) favourites++;
      }
    });

    return { all, favourites, archived, trash };
  }, [notes]);

  // Filtered notes
  const filteredNotes = useMemo(() => {
    return notes.filter(n => {
      // Search query check
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = n.title?.toLowerCase().includes(q);
        const matchContent = n.content?.toLowerCase().includes(q);
        const matchTag = n.tags?.some(t => t.toLowerCase().includes(q));
        if (!matchTitle && !matchContent && !matchTag) return false;
      }

      // Filter category check
      if (filterType === 'trash') return !!n.isTrash;
      if (n.isTrash) return false; // Hide trash notes from other views

      if (filterType === 'archived') return !!n.isArchived;
      if (n.isArchived) return false; // Hide archived notes from standard views

      if (filterType === 'favourites') return !!n.isFavourite;
      if (filterType === 'all') return true;

      if (filterType === 'folder') {
        return n.folder === selectedFolder;
      }

      if (filterType === 'tag' && selectedTag) {
        return n.tags?.includes(selectedTag);
      }

      return true;
    }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [notes, filterType, selectedFolder, selectedTag, searchQuery]);

  // Active note
  const currentNote = useMemo(() => {
    return notes.find(n => n.id === selectedNoteId) || null;
  }, [notes, selectedNoteId]);

  // Select note handler
  const handleSelectNote = (id: string) => {
    setSelectedNoteId(id);
    setMobileShowEditor(true);
  };

  // Create new note
  const handleCreateNote = (templateKey?: string) => {
    const template = templateKey && TEMPLATES[templateKey] ? TEMPLATES[templateKey] : TEMPLATES.blank;
    const now = new Date().toISOString();
    const newNote: NotebookNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      userId: user?.id,
      title: template.title || 'Untitled Note',
      content: template.content || '',
      folder: filterType === 'folder' ? selectedFolder : (template.folder || 'Daily Journal'),
      tags: template.tags ? [...template.tags] : ['review'],
      mood: template.mood || 'Disciplined',
      isFavourite: false,
      isArchived: false,
      isTrash: false,
      createdAt: now,
      updatedAt: now
    };

    setNotes(prev => [newNote, ...prev]);
    setSelectedNoteId(newNote.id);
    setMobileShowEditor(true);
    setTemplateMenuOpen(false);

    // If currently looking at trash or archived, switch back to folder/all
    if (filterType === 'trash' || filterType === 'archived') {
      setFilterType('folder');
      setSelectedFolder(newNote.folder);
    }
  };

  // Update note field
  const handleUpdateNote = (field: keyof NotebookNote, value: any) => {
    if (!selectedNoteId) return;
    setNotes(prev => prev.map(n => {
      if (n.id === selectedNoteId) {
        return {
          ...n,
          [field]: value,
          updatedAt: new Date().toISOString()
        };
      }
      return n;
    }));

    // Trigger save indicator
    setSaveStatus('saved');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setSaveStatus('idle');
    }, 2000);
  };

  // Toggle favorite
  const handleToggleFavourite = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setNotes(prev => prev.map(n => {
      if (n.id === id) {
        return { ...n, isFavourite: !n.isFavourite, updatedAt: new Date().toISOString() };
      }
      return n;
    }));
  };

  // Move to trash or restore
  const handleTrashToggle = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setNotes(prev => prev.map(n => {
      if (n.id === id) {
        return { ...n, isTrash: !n.isTrash, updatedAt: new Date().toISOString() };
      }
      return n;
    }));
  };

  // Permanent delete
  const handlePermanentDelete = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (window.confirm('Are you sure you want to permanently delete this note?')) {
      setNotes(prev => prev.filter(n => n.id !== id));
      if (selectedNoteId === id) {
        setSelectedNoteId(null);
        setMobileShowEditor(false);
      }
    }
  };

  // Archive toggle
  const handleArchiveToggle = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setNotes(prev => prev.map(n => {
      if (n.id === id) {
        return { ...n, isArchived: !n.isArchived, updatedAt: new Date().toISOString() };
      }
      return n;
    }));
  };

  // Add folder
  const handleAddFolder = () => {
    const trimmed = newFolderName.trim();
    if (trimmed && !folders.includes(trimmed)) {
      setFolders(prev => [...prev, trimmed]);
      setSelectedFolder(trimmed);
      setFilterType('folder');
      setNewFolderName('');
      setIsAddingFolder(false);
    }
  };

  // Add tag
  const handleAddTag = () => {
    const trimmed = newTagName.trim().toLowerCase().replace(/^#/, '');
    if (trimmed && !customTags.includes(trimmed)) {
      setCustomTags(prev => [...prev, trimmed]);
      setNewTagName('');
      setIsAddingTag(false);
    }
  };

  // Toggle tag on active note
  const handleToggleTagOnNote = (tag: string) => {
    if (!currentNote) return;
    const exists = currentNote.tags?.includes(tag);
    const updated = exists
      ? currentNote.tags.filter(t => t !== tag)
      : [...(currentNote.tags || []), tag];
    handleUpdateNote('tags', updated);
  };

  // Formatting helpers for rich text area
  const insertFormatting = (prefix: string, suffix: string = '', defaultText: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea || !currentNote) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = currentNote.content;
    const selected = text.substring(start, end) || defaultText;

    const before = text.substring(0, start);
    const after = text.substring(end);
    const newContent = `${before}${prefix}${selected}${suffix}${after}`;

    handleUpdateNote('content', newContent);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 50);
  };

  // Toggle checklist item interactive click
  const handleToggleChecklist = (lineIndex: number) => {
    if (!currentNote) return;
    const lines = currentNote.content.split('\n');
    const targetLine = lines[lineIndex];
    if (targetLine.includes('- [ ]')) {
      lines[lineIndex] = targetLine.replace('- [ ]', '- [x]');
    } else if (targetLine.includes('- [x]')) {
      lines[lineIndex] = targetLine.replace('- [x]', '- [ ]');
    }
    handleUpdateNote('content', lines.join('\n'));
  };

  // Export note as text file
  const handleExportNote = () => {
    if (!currentNote) return;
    const element = document.createElement('a');
    const file = new Blob([`# ${currentNote.title}\n\nFolder: ${currentNote.folder}\nTags: ${currentNote.tags.join(', ')}\nDate: ${new Date(currentNote.updatedAt).toLocaleString()}\nMood: ${currentNote.mood || 'N/A'}\n\n---\n\n${currentNote.content}`], { type: 'text/markdown' });
    element.href = URL.createObjectURL(file);
    element.download = `${currentNote.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Header Title
  const getHeaderTitle = () => {
    if (filterType === 'all') return 'ALL NOTES';
    if (filterType === 'favourites') return 'FAVOURITES';
    if (filterType === 'archived') return 'ARCHIVED';
    if (filterType === 'trash') return 'TRASH';
    if (filterType === 'folder') return selectedFolder.toUpperCase();
    if (filterType === 'tag') return `#${selectedTag?.toUpperCase()}`;
    return 'NOTEBOOK';
  };

  return (
    <div className="w-full text-slate-100 antialiased">
      {/* Main Glass Workspace Container */}
      <div className="relative rounded-2xl bg-[#090d16] border border-slate-800/80 shadow-2xl overflow-hidden min-h-[720px] flex flex-col md:flex-row">
        
        {/* ========================================================
            LEFT SIDEBAR (Search, New button, Navigation, Folders, Tags)
           ======================================================== */}
        <aside className={`w-full md:w-64 lg:w-72 shrink-0 bg-[#070a12]/95 border-b md:border-b-0 md:border-r border-slate-800/80 p-4 flex flex-col justify-between select-none ${mobileShowEditor ? 'hidden md:flex' : 'flex'}`}>
          <div className="space-y-4">
            
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search notes..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-[#0d1322] border border-slate-700/60 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* + New Button with Template Dropdown */}
            <div className="relative" ref={templateMenuRef}>
              <div className="flex items-center w-full rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 shadow-lg shadow-indigo-600/25 transition">
                <button
                  onClick={() => handleCreateNote()}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 pl-4 pr-2 text-xs font-bold text-white tracking-wide active:scale-98"
                >
                  <Plus className="h-4 w-4" />
                  <span>New</span>
                </button>
                <button
                  onClick={() => setTemplateMenuOpen(!templateMenuOpen)}
                  className="px-2.5 py-2.5 border-l border-white/20 text-white/90 hover:text-white hover:bg-white/10 rounded-r-xl transition"
                  title="Choose Template"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${templateMenuOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {/* Template Selection Popup */}
              {templateMenuOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 z-50 rounded-xl bg-[#0f172a] border border-slate-700/80 shadow-2xl p-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
                  <div className="px-2.5 py-1 text-[10px] font-mono uppercase text-slate-400 tracking-wider">
                    Quick Templates
                  </div>
                  <button
                    onClick={() => handleCreateNote('blank')}
                    className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-indigo-600/20 hover:text-indigo-300 flex items-center gap-2 transition"
                  >
                    <FileText className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Blank Note</span>
                  </button>
                  <button
                    onClick={() => handleCreateNote('preMarket')}
                    className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-indigo-600/20 hover:text-indigo-300 flex items-center gap-2 transition"
                  >
                    <span className="text-sm">🌅</span>
                    <span>Daily Pre-Market Prep</span>
                  </button>
                  <button
                    onClick={() => handleCreateNote('postMarket')}
                    className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-indigo-600/20 hover:text-indigo-300 flex items-center gap-2 transition"
                  >
                    <span className="text-sm">🌆</span>
                    <span>Daily Post-Market Review</span>
                  </button>
                  <button
                    onClick={() => handleCreateNote('psychology')}
                    className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-indigo-600/20 hover:text-indigo-300 flex items-center gap-2 transition"
                  >
                    <span className="text-sm">🧠</span>
                    <span>Psychology & Mindset Check</span>
                  </button>
                  <button
                    onClick={() => handleCreateNote('weeklyAudit')}
                    className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-indigo-600/20 hover:text-indigo-300 flex items-center gap-2 transition"
                  >
                    <span className="text-sm">📊</span>
                    <span>Weekly Performance Audit</span>
                  </button>
                </div>
              )}
            </div>

            {/* Main Navigation Items */}
            <nav className="space-y-0.5 pt-1">
              <button
                onClick={() => { setFilterType('all'); setSelectedTag(null); }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition ${
                  filterType === 'all'
                    ? 'bg-indigo-600/20 text-indigo-300 font-semibold border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <FileText className="h-4 w-4" />
                  <span>All notes</span>
                </div>
                <span className="text-[10px] text-slate-500">{navCounts.all}</span>
              </button>

              <button
                onClick={() => { setFilterType('favourites'); setSelectedTag(null); }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition ${
                  filterType === 'favourites'
                    ? 'bg-amber-500/15 text-amber-300 font-semibold border border-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Star className="h-4 w-4" />
                  <span>Favourites</span>
                </div>
                <span className="text-[10px] text-slate-500">{navCounts.favourites}</span>
              </button>

              <button
                onClick={() => { setFilterType('archived'); setSelectedTag(null); }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition ${
                  filterType === 'archived'
                    ? 'bg-slate-800 text-slate-200 font-semibold border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Archive className="h-4 w-4" />
                  <span>Archived</span>
                </div>
                <span className="text-[10px] text-slate-500">{navCounts.archived}</span>
              </button>

              <button
                onClick={() => { setFilterType('trash'); setSelectedTag(null); }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition ${
                  filterType === 'trash'
                    ? 'bg-rose-500/15 text-rose-300 font-semibold border border-rose-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <Trash2 className="h-4 w-4" />
                  <span>Trash</span>
                </div>
                <span className="text-[10px] text-slate-500">{navCounts.trash}</span>
              </button>
            </nav>

            {/* FOLDERS Section */}
            <div className="pt-2">
              <div className="flex items-center justify-between px-3 pb-1.5">
                <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400 font-semibold">
                  FOLDERS
                </span>
                <button
                  onClick={() => setIsAddingFolder(true)}
                  className="text-slate-500 hover:text-indigo-400 transition"
                  title="Add Folder"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {isAddingFolder && (
                <div className="px-2 py-1 mb-1">
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      placeholder="Folder name..."
                      value={newFolderName}
                      onChange={e => setNewFolderName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddFolder()}
                      autoFocus
                      className="w-full bg-[#0d1322] border border-indigo-500/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none"
                    />
                    <button onClick={handleAddFolder} className="p-1 text-indigo-400 hover:text-indigo-300">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setIsAddingFolder(false)} className="p-1 text-slate-500 hover:text-slate-400">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-0.5">
                {folders.map(folder => {
                  const isSelected = filterType === 'folder' && selectedFolder === folder;
                  return (
                    <button
                      key={folder}
                      onClick={() => {
                        setFilterType('folder');
                        setSelectedFolder(folder);
                        setSelectedTag(null);
                      }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition ${
                        isSelected
                          ? 'bg-[#15233e] text-blue-400 font-semibold border border-blue-500/30'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Folder className={`h-4 w-4 shrink-0 ${isSelected ? 'text-blue-400' : 'text-slate-500'}`} />
                        <span className="truncate">{folder}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 shrink-0 ml-2">
                        {folderCounts[folder] || 0}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* TAGS Section */}
            <div className="pt-2">
              <div className="flex items-center justify-between px-3 pb-1.5">
                <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400 font-semibold">
                  TAGS
                </span>
                <button
                  onClick={() => setIsAddingTag(true)}
                  className="text-slate-500 hover:text-indigo-400 transition"
                  title="Add Tag"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              {isAddingTag && (
                <div className="px-2 py-1 mb-1">
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      placeholder="tag (e.g. risk)..."
                      value={newTagName}
                      onChange={e => setNewTagName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                      autoFocus
                      className="w-full bg-[#0d1322] border border-indigo-500/60 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none"
                    />
                    <button onClick={handleAddTag} className="p-1 text-indigo-400 hover:text-indigo-300">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setIsAddingTag(false)} className="p-1 text-slate-500 hover:text-slate-400">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-0.5">
                {customTags.map(tag => {
                  const isSelected = filterType === 'tag' && selectedTag === tag;
                  return (
                    <button
                      key={tag}
                      onClick={() => {
                        setFilterType('tag');
                        setSelectedTag(tag);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs transition ${
                        isSelected
                          ? 'bg-violet-600/20 text-violet-300 font-semibold border border-violet-500/30'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                      }`}
                    >
                      <TagIcon className={`h-3.5 w-3.5 ${isSelected ? 'text-violet-400' : 'text-slate-500'}`} />
                      <span>{tag}</span>
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* Bottom user badge or quote */}
          <div className="pt-4 border-t border-slate-800/60 text-[11px] text-slate-500 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-indigo-400" />
              <span>Offline & Auto-Saved</span>
            </span>
            <span className="font-mono text-[10px] text-slate-600">{notes.length} notes</span>
          </div>
        </aside>

        {/* ========================================================
            RIGHT MAIN PANE (Notes List & Rich Editor)
           ======================================================== */}
        <section className={`flex-1 flex flex-col min-w-0 bg-[#060913] ${mobileShowEditor ? 'flex' : 'hidden md:flex'}`}>
          
          {/* Top Bar / Breadcrumb Header */}
          <div className="h-14 border-b border-slate-800/80 px-4 sm:px-6 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              {mobileShowEditor && (
                <button
                  onClick={() => setMobileShowEditor(false)}
                  className="md:hidden p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-slate-400 font-semibold">
                {getHeaderTitle()}
              </span>
            </div>

            {/* Quick Actions in Header */}
            {currentNote && (
              <div className="flex items-center gap-2">
                {/* Save status badge */}
                {saveStatus === 'saved' && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full animate-fade-in">
                    <Check className="h-3 w-3" /> Saved
                  </span>
                )}

                {/* Favourite */}
                <button
                  onClick={() => handleToggleFavourite(currentNote.id)}
                  className={`p-1.5 rounded-lg border transition ${
                    currentNote.isFavourite
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                      : 'border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                  title={currentNote.isFavourite ? 'Unmark Favourite' : 'Mark Favourite'}
                >
                  <Star className="h-4 w-4 fill-current" />
                </button>

                {/* Export Markdown */}
                <button
                  onClick={handleExportNote}
                  className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition"
                  title="Export Note (.md)"
                >
                  <Download className="h-4 w-4" />
                </button>

                {/* Archive / Unarchive */}
                <button
                  onClick={() => handleArchiveToggle(currentNote.id)}
                  className={`p-1.5 rounded-lg border transition ${
                    currentNote.isArchived
                      ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
                      : 'border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                  title={currentNote.isArchived ? 'Unarchive' : 'Archive'}
                >
                  <Archive className="h-4 w-4" />
                </button>

                {/* Trash or Permanent Delete */}
                {currentNote.isTrash ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleTrashToggle(currentNote.id)}
                      className="px-2.5 py-1 text-xs rounded-lg bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 transition"
                    >
                      Restore
                    </button>
                    <button
                      onClick={() => handlePermanentDelete(currentNote.id)}
                      className="p-1.5 rounded-lg border border-rose-500/30 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 transition"
                      title="Permanently Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleTrashToggle(currentNote.id)}
                    className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                    title="Move to Trash"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Main Body: Split View or Empty State */}
          <div className="flex-1 flex overflow-hidden">
            
            {/* If there are NO notes matching the filter */}
            {filteredNotes.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-fade-in">
                {/* Rounded document icon matching the screenshot */}
                <div className="w-16 h-16 rounded-2xl border-2 border-slate-700/60 bg-[#0d1322] flex items-center justify-center text-slate-300 mb-4 shadow-lg">
                  <FileText className="h-8 w-8 text-slate-400 stroke-[1.5]" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">
                  No notes found
                </h3>
                <p className="text-xs text-slate-400 mb-6">
                  Click 'New' to start journaling.
                </p>
                <button
                  onClick={() => handleCreateNote('blank')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition active:scale-95"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create Note</span>
                </button>
              </div>
            ) : (
              /* Two Column Layout: Left Notes List + Right Full Editor */
              <div className="flex-1 flex overflow-hidden">
                
                {/* Note Cards List (Left Column) */}
                <div className={`w-full ${currentNote ? 'md:w-72 lg:w-80' : 'w-full'} shrink-0 border-r border-slate-800/80 overflow-y-auto divide-y divide-slate-800/60 bg-[#070b14]/50 custom-scrollbar`}>
                  {filteredNotes.map(note => {
                    const isSelected = selectedNoteId === note.id;
                    const previewText = note.content
                      ? note.content.replace(/[#*`>-]/g, '').trim().slice(0, 100)
                      : 'No additional text...';
                    
                    return (
                      <div
                        key={note.id}
                        onClick={() => handleSelectNote(note.id)}
                        className={`p-3.5 cursor-pointer transition relative group ${
                          isSelected
                            ? 'bg-[#10172a] border-l-2 border-indigo-500'
                            : 'hover:bg-slate-800/30'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h4 className={`text-xs font-semibold truncate ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                            {note.title || 'Untitled Note'}
                          </h4>
                          <button
                            onClick={e => handleToggleFavourite(note.id, e)}
                            className="text-slate-500 hover:text-amber-400 shrink-0"
                          >
                            <Star className={`h-3.5 w-3.5 ${note.isFavourite ? 'text-amber-400 fill-amber-400' : ''}`} />
                          </button>
                        </div>

                        <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed mb-2">
                          {previewText}
                        </p>

                        <div className="flex items-center justify-between text-[10px] text-slate-500">
                          <span className="font-mono">
                            {new Date(note.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>

                          <div className="flex items-center gap-1.5">
                            {note.mood && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300">
                                {note.mood === 'Calm' && '🧘'}
                                {note.mood === 'Disciplined' && '🎯'}
                                {note.mood === 'Confident' && '🏆'}
                                {note.mood === 'Excited' && '⚡'}
                                {note.mood === 'Anxious' && '⚠️'}
                                {note.mood === 'FOMO' && '🔥'}
                                {note.mood === 'Frustrated' && '😤'}
                                <span className="ml-1">{note.mood}</span>
                              </span>
                            )}
                            {note.tags && note.tags.length > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 text-[9px] font-mono">
                                #{note.tags[0]}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Note Editor Area (Right Column) */}
                {currentNote ? (
                  <div className="flex-1 flex flex-col bg-[#060913] overflow-hidden">
                    
                    {/* Note Meta Bar (Folder, Mood, Tags) */}
                    <div className="px-5 py-2.5 border-b border-slate-800/80 bg-[#0a0e1b]/40 flex flex-wrap items-center justify-between gap-3 text-xs">
                      
                      {/* Folder Selector */}
                      <div className="flex items-center gap-2">
                        <Folder className="h-3.5 w-3.5 text-blue-400" />
                        <select
                          value={currentNote.folder}
                          onChange={e => handleUpdateNote('folder', e.target.value)}
                          className="bg-transparent text-slate-300 font-medium focus:outline-none cursor-pointer border-none p-0 text-xs"
                        >
                          {folders.map(f => (
                            <option key={f} value={f} className="bg-[#0f172a] text-slate-200">
                              {f}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Mindset / Mood Selector */}
                      <div className="flex items-center gap-2">
                        <Smile className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-slate-400 text-[11px]">Mindset:</span>
                        <select
                          value={currentNote.mood || 'Disciplined'}
                          onChange={e => handleUpdateNote('mood', e.target.value)}
                          className="bg-transparent text-slate-300 font-medium focus:outline-none cursor-pointer border-none p-0 text-xs"
                        >
                          <option value="Disciplined" className="bg-[#0f172a] text-slate-200">🎯 Disciplined</option>
                          <option value="Calm" className="bg-[#0f172a] text-slate-200">🧘 Calm</option>
                          <option value="Confident" className="bg-[#0f172a] text-slate-200">🏆 Confident</option>
                          <option value="Excited" className="bg-[#0f172a] text-slate-200">⚡ Excited</option>
                          <option value="Anxious" className="bg-[#0f172a] text-slate-200">⚠️ Anxious</option>
                          <option value="FOMO" className="bg-[#0f172a] text-slate-200">🔥 FOMO</option>
                          <option value="Frustrated" className="bg-[#0f172a] text-slate-200">😤 Frustrated</option>
                        </select>
                      </div>

                      {/* Tags chips on note */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <TagIcon className="h-3.5 w-3.5 text-violet-400" />
                        {customTags.map(tag => {
                          const hasTag = currentNote.tags?.includes(tag);
                          return (
                            <button
                              key={tag}
                              onClick={() => handleToggleTagOnNote(tag)}
                              className={`px-2 py-0.5 rounded-full text-[10px] font-mono transition ${
                                hasTag
                                  ? 'bg-violet-600/30 border border-violet-500/50 text-violet-200'
                                  : 'bg-slate-800/60 border border-slate-700/60 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              #{tag}
                            </button>
                          );
                        })}
                      </div>

                    </div>

                    {/* Rich Formatting Toolbar */}
                    <div className="px-5 py-2 border-b border-slate-800/80 bg-[#070a12]/60 flex items-center gap-1 overflow-x-auto custom-scrollbar">
                      <button
                        onClick={() => insertFormatting('**', '**', 'bold text')}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        title="Bold (Ctrl+B)"
                      >
                        <Bold className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => insertFormatting('*', '*', 'italic text')}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        title="Italic (Ctrl+I)"
                      >
                        <Italic className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => insertFormatting('~~', '~~', 'strikethrough text')}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        title="Strikethrough"
                      >
                        <Strikethrough className="h-3.5 w-3.5" />
                      </button>

                      <div className="h-4 w-px bg-slate-800 mx-1" />

                      <button
                        onClick={() => insertFormatting('# ', '', 'Heading 1')}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        title="Heading 1"
                      >
                        <Heading1 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => insertFormatting('## ', '', 'Heading 2')}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        title="Heading 2"
                      >
                        <Heading2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => insertFormatting('### ', '', 'Heading 3')}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        title="Heading 3"
                      >
                        <Heading3 className="h-3.5 w-3.5" />
                      </button>

                      <div className="h-4 w-px bg-slate-800 mx-1" />

                      <button
                        onClick={() => insertFormatting('- ', '', 'List item')}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        title="Bullet List"
                      >
                        <List className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => insertFormatting('1. ', '', 'Numbered item')}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        title="Numbered List"
                      >
                        <ListOrdered className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => insertFormatting('- [ ] ', '', 'Task to complete')}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        title="Checklist / Todo"
                      >
                        <CheckSquare className="h-3.5 w-3.5 text-indigo-400" />
                      </button>

                      <div className="h-4 w-px bg-slate-800 mx-1" />

                      <button
                        onClick={() => insertFormatting('> ', '', 'Trading quote or reminder')}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        title="Quote Block"
                      >
                        <Quote className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => insertFormatting('`', '`', 'code or formula')}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        title="Inline Code"
                      >
                        <Code className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => insertFormatting('\n---\n', '', '')}
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
                        title="Divider Line"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Note Content Editor Area */}
                    <div className="flex-1 flex flex-col p-5 overflow-y-auto custom-scrollbar">
                      {/* Title Input */}
                      <input
                        type="text"
                        value={currentNote.title}
                        onChange={e => handleUpdateNote('title', e.target.value)}
                        placeholder="Note title..."
                        className="w-full bg-transparent text-xl sm:text-2xl font-extrabold text-white placeholder-slate-600 focus:outline-none mb-3 font-display"
                      />

                      {/* Interactive Checklists Section (if any in content) */}
                      {currentNote.content.includes('- [ ]') || currentNote.content.includes('- [x]') ? (
                        <div className="mb-4 p-3 rounded-xl bg-[#0b101e] border border-indigo-500/20">
                          <div className="text-[10px] font-mono uppercase tracking-wider text-indigo-400 font-semibold mb-2 flex items-center gap-1.5">
                            <CheckSquare className="h-3 w-3" />
                            <span>Interactive Checklist</span>
                          </div>
                          <div className="space-y-1.5">
                            {currentNote.content.split('\n').map((line, idx) => {
                              if (line.includes('- [ ]') || line.includes('- [x]')) {
                                const isChecked = line.includes('- [x]');
                                const label = line.replace(/- \[[ x]\]\s*/, '');
                                return (
                                  <label
                                    key={idx}
                                    className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer hover:text-white"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => handleToggleChecklist(idx)}
                                      className="rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-0 focus:ring-offset-0 h-3.5 w-3.5 cursor-pointer"
                                    />
                                    <span className={isChecked ? 'line-through text-slate-500' : ''}>
                                      {label}
                                    </span>
                                  </label>
                                );
                              }
                              return null;
                            })}
                          </div>
                        </div>
                      ) : null}

                      {/* Main Note Markdown Textarea */}
                      <textarea
                        ref={textareaRef}
                        value={currentNote.content}
                        onChange={e => handleUpdateNote('content', e.target.value)}
                        placeholder="Write your trading notes, analysis, feelings, plans, and lessons here... (Markdown supported)"
                        className="flex-1 w-full bg-transparent text-slate-200 text-sm leading-relaxed placeholder-slate-600 focus:outline-none resize-none font-sans"
                        rows={16}
                      />
                    </div>

                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-500">
                    <FileText className="h-10 w-10 text-slate-600 mb-2" />
                    <p className="text-xs">Select a note to read or edit</p>
                  </div>
                )}

              </div>
            )}

          </div>

        </section>

      </div>
    </div>
  );
}
