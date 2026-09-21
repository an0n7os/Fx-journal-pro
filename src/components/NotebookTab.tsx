import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  FileText, Star, Archive, Trash2, Folder, Tag as TagIcon, Plus, ChevronDown,
  Search, Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare, Quote, Code, Minus, Save, Sparkles,
  ArrowLeft, Share2, Download, RefreshCw, X, Check, Smile, AlertCircle, Image
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

const DEFAULT_FOLDERS: string[] = [];

const DEFAULT_TAGS: string[] = [];

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
  const [filterType, setFilterType] = useState<string>('all');
  const [selectedFolder, setSelectedFolder] = useState<string>('');
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

  // Inline confirm for permanent delete
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  // Auto-select first note if none selected or selected note no longer in filtered list
  useEffect(() => {
    if (filteredNotes.length > 0) {
      if (!selectedNoteId || !filteredNotes.some(n => n.id === selectedNoteId)) {
        setSelectedNoteId(filteredNotes[0].id);
      }
    } else {
      setSelectedNoteId(null);
    }
  }, [filteredNotes, selectedNoteId]);

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

  // Permanent delete (no confirm dialog — uses inline confirm UI instead)
  const handlePermanentDelete = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setNotes(prev => prev.filter(n => n.id !== id));
    if (selectedNoteId === id) {
      setSelectedNoteId(null);
      setMobileShowEditor(false);
    }
    setConfirmDeleteId(null);
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

  // Delete folder
  const handleDeleteFolder = (folder: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (filterType === 'folder' && selectedFolder === folder) {
      setFilterType('all');
      setSelectedFolder('');
    }
    setFolders(prev => prev.filter(f => f !== folder));
  };

  // Image upload ref
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Handle image upload for current note
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!currentNote) return;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        setNotes(prev => prev.map(n => n.id === currentNote.id
          ? { ...n, images: [...(n.images || []), base64], updatedAt: new Date().toISOString() }
          : n
        ));
      };
      reader.readAsDataURL(file);
    });
    // reset input
    e.target.value = '';
  };

  // Delete image from current note
  const handleDeleteImage = (index: number) => {
    if (!currentNote) return;
    setNotes(prev => prev.map(n => n.id === currentNote.id
      ? { ...n, images: (n.images || []).filter((_, i) => i !== index), updatedAt: new Date().toISOString() }
      : n
    ));
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

  // Delete tag
  const handleDeleteTag = (tag: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCustomTags(prev => prev.filter(t => t !== tag));
    // Remove tag from any notes that have it
    setNotes(prev => prev.map(n => ({
      ...n,
      tags: n.tags?.filter(t => t !== tag) || []
    })));
    // If currently filtering by deleted tag, reset
    if (filterType === 'tag' && selectedTag === tag) {
      setFilterType('all');
      setSelectedTag(null);
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
    <div className="w-full text-slate-100 antialiased pb-8">
      {/* Main Glass Workspace Container */}
      <div className="relative rounded-2xl bg-[#080C16] border border-slate-800/90 shadow-2xl overflow-hidden min-h-[680px] h-[calc(100vh-215px)] flex flex-col md:flex-row backdrop-blur-xl">
        
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
                    <div
                      key={folder}
                      onClick={() => {
                        setFilterType('folder');
                        setSelectedFolder(folder);
                        setSelectedTag(null);
                      }}
                      className={`group w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition cursor-pointer ${
                        isSelected
                          ? 'bg-[#15233e] text-blue-400 font-semibold border border-blue-500/30'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 truncate min-w-0">
                        <Folder className={`h-4 w-4 shrink-0 ${isSelected ? 'text-blue-400' : 'text-slate-500'}`} />
                        <span className="truncate">{folder}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <span className="text-[10px] text-slate-500 group-hover:hidden">
                          {folderCounts[folder] || 0}
                        </span>
                        <button
                          onClick={(e) => handleDeleteFolder(folder, e)}
                          className="hidden group-hover:flex p-0.5 rounded hover:bg-rose-500/20 hover:text-rose-400 text-slate-500 transition-all duration-150"
                          title={`Delete folder "${folder}"`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
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
                    <div
                      key={tag}
                      className={`group w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs transition cursor-pointer ${
                        isSelected
                          ? 'bg-violet-600/20 text-violet-300 font-semibold border border-violet-500/30'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                      }`}
                      onClick={() => {
                        setFilterType('tag');
                        setSelectedTag(tag);
                      }}
                    >
                      <TagIcon className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-violet-400' : 'text-slate-500'}`} />
                      <span className="flex-1 truncate">{tag}</span>
                      <button
                        onClick={(e) => handleDeleteTag(tag, e)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-rose-500/20 hover:text-rose-400 text-slate-500 transition-all duration-150 shrink-0"
                        title={`Delete #${tag}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
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
        {filteredNotes.length === 0 ? (
          /* Empty state matching user's original screenshot */
          <section className="flex-1 flex flex-col min-w-0 bg-[#060913] overflow-hidden">
            <div className="h-14 border-b border-slate-800/80 px-6 flex items-center justify-between shrink-0 bg-[#070a12]/40">
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-300 font-sans">
                {getHeaderTitle()}
              </span>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center animate-fade-in">
              <div className="w-16 h-16 rounded-2xl border border-slate-700/80 bg-slate-900/60 flex items-center justify-center text-slate-300 mb-4 shadow-xl">
                <FileText className="h-8 w-8 text-slate-300 stroke-[1.5]" />
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
          </section>
        ) : (
          /* 2 Panes when notes exist: Column 2 (Notes List) + Column 3 (Full Note Editor) */
          <>
            {/* Column 2: Note Cards List */}
            <section className={`w-full md:w-72 lg:w-80 shrink-0 border-b md:border-b-0 md:border-r border-slate-800/80 bg-[#070b14]/70 flex flex-col min-w-0 ${mobileShowEditor ? 'hidden md:flex' : 'flex'}`}>
              <div className="h-14 border-b border-slate-800/80 px-4 flex items-center justify-between shrink-0 bg-[#070a12]/40">
                <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-300 font-sans truncate">
                  {getHeaderTitle()}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-400 border border-slate-700/50">
                  {filteredNotes.length} {filteredNotes.length === 1 ? 'note' : 'notes'}
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
                {filteredNotes.map(note => {
                  const isSelected = selectedNoteId === note.id;
                  const previewText = note.content
                    ? note.content.replace(/[#*`>-]/g, '').trim().slice(0, 110)
                    : 'No additional text...';
                  const dateStr = new Date(note.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                  return (
                    <div
                      key={note.id}
                      onClick={() => handleSelectNote(note.id)}
                      className={`p-3 rounded-xl cursor-pointer transition relative group border ${
                        isSelected
                          ? 'bg-indigo-600/15 border-indigo-500/50 text-white shadow-md shadow-indigo-950/40 ring-1 ring-indigo-500/20'
                          : 'bg-slate-900/30 border-slate-800/50 hover:bg-slate-800/50 hover:border-slate-700/60 text-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className={`text-xs font-semibold truncate ${isSelected ? 'text-white' : 'text-slate-200'}`}>
                          {note.title || 'Untitled Note'}
                        </h4>
                        {filterType === 'trash' ? (
                          confirmDeleteId === note.id ? (
                            // Inline confirm step
                            <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                              <button
                                onClick={(e) => handlePermanentDelete(note.id, e)}
                                className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-600/80 border border-rose-500/60 text-white hover:bg-rose-500 transition"
                              >
                                Delete!
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                                className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleTrashToggle(note.id, e); }}
                                className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 transition"
                                title="Restore note"
                              >
                                Restore
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(note.id); }}
                                className="p-1 rounded hover:bg-rose-500/20 text-slate-600 hover:text-rose-400 transition"
                                title="Permanently delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleFavourite(note.id, e);
                            }}
                            className={`p-1 rounded hover:bg-white/10 shrink-0 ${note.isFavourite ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
                          >
                            <Star className={`h-3.5 w-3.5 ${note.isFavourite ? 'fill-current' : ''}`} />
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-2 mb-2.5 leading-snug">
                        {previewText}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1.5 border-t border-slate-800/40">
                        <span>{dateStr}</span>
                        <div className="flex items-center gap-1.5 overflow-hidden">
                          {note.mood && (
                            <span className="px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/25 text-[9px] font-medium truncate max-w-[85px]">
                              {note.mood}
                            </span>
                          )}
                          {note.tags && note.tags.length > 0 && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700/50 text-[9px] font-mono">
                              #{note.tags[0]}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Column 3: Full Note Editor */}
            <section className={`flex-1 flex flex-col min-w-0 bg-[#060913] overflow-hidden ${mobileShowEditor ? 'flex' : 'hidden md:flex'}`}>
              {currentNote ? (
                <>
                  {/* Editor Top Bar */}
                  <div className="h-14 border-b border-slate-800/80 px-4 sm:px-6 flex items-center justify-between shrink-0 bg-[#070a12]/40">
                    <div className="flex items-center gap-3 min-w-0">
                      {mobileShowEditor && (
                        <button
                          onClick={() => setMobileShowEditor(false)}
                          className="md:hidden p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white shrink-0"
                        >
                          <ArrowLeft className="h-4 w-4" />
                        </button>
                      )}
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400 truncate">
                        {currentNote.folder}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {saveStatus === 'saved' && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full animate-fade-in">
                          <Check className="h-3 w-3" /> Saved
                        </span>
                      )}

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

                      <button
                        onClick={handleExportNote}
                        className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition"
                        title="Export Note (.md)"
                      >
                        <Download className="h-4 w-4" />
                      </button>

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
                  </div>

                  {/* Note Meta Bar */}
                  <div className="px-5 py-2.5 border-b border-slate-800/80 bg-[#0a0e1b]/40 flex flex-wrap items-center justify-between gap-3 text-xs">
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

                    {/* Attached Images */}
                    {currentNote.images && currentNote.images.length > 0 && (
                      <div className="mt-5 pt-4 border-t border-slate-800/60">
                        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold mb-3 flex items-center gap-1.5">
                          <Image className="h-3 w-3 text-emerald-400" />
                          <span>Attached Images ({currentNote.images.length})</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {currentNote.images.map((src, idx) => (
                            <div key={idx} className="group relative rounded-xl overflow-hidden border border-slate-800/60 hover:border-slate-700 transition bg-[#0b101e]">
                              <img
                                src={src}
                                alt={`Attached ${idx + 1}`}
                                className="w-full h-32 object-cover"
                              />
                              <button
                                onClick={() => handleDeleteImage(idx)}
                                className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1 rounded-lg bg-rose-600/80 hover:bg-rose-500 text-white transition-all duration-150 backdrop-blur-sm"
                                title="Remove image"
                              >
                                <X className="h-3 w-3" />
                              </button>
                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1 text-[9px] text-slate-300 truncate">
                                Image {idx + 1}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-500">
                  <FileText className="h-10 w-10 text-slate-600 mb-2" />
                  <p className="text-xs">Select a note to read or edit</p>
                </div>
              )}
            </section>
          </>
        )}

      </div>
    </div>
  );
}
