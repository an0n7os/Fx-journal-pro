import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  MousePointer,
  TrendingUp,
  Minus,
  ArrowUpRight,
  Square,
  Paintbrush,
  AlignJustify,
  Type,
  Ruler,
  Trash2,
  Undo2,
  Palette,
  Check,
} from 'lucide-react';

export type DrawingTool =
  | 'cursor'
  | 'trendline'
  | 'horizontal'
  | 'ray'
  | 'rectangle'
  | 'brush'
  | 'fibonacci'
  | 'text'
  | 'measure';

export interface Point {
  x: number;
  y: number;
}

export interface DrawingItem {
  id: string;
  type: DrawingTool;
  color: string;
  lineWidth: number;
  points: Point[];
  text?: string;
}

interface ChartDrawingToolsProps {
  symbol: string;
  isDark: boolean;
  containerWidth: number;
  containerHeight: number;
}

const COLOR_PRESETS = [
  { name: 'Yellow', value: '#eab308' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Green', value: '#10b981' },
  { name: 'Red', value: '#f43f5e' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'White', value: '#ffffff' },
];

const FIB_LEVELS = [
  { level: 0, label: '0.0 (0%)', color: '#64748b' },
  { level: 0.236, label: '0.236 (23.6%)', color: '#06b6d4' },
  { level: 0.382, label: '0.382 (38.2%)', color: '#10b981' },
  { level: 0.5, label: '0.5 (50.0%)', color: '#eab308' },
  { level: 0.618, label: '0.618 (61.8%)', color: '#f59e0b' },
  { level: 0.786, label: '0.786 (78.6%)', color: '#f43f5e' },
  { level: 1.0, label: '1.0 (100%)', color: '#8b5cf6' },
];

export const ChartDrawingTools: React.FC<ChartDrawingToolsProps> = ({
  symbol,
  isDark,
  containerWidth,
  containerHeight,
}) => {
  const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
  const [activeColor, setActiveColor] = useState<string>('#06b6d4');
  const [lineWidth, setLineWidth] = useState<number>(2);
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false);
  const [drawings, setDrawings] = useState<DrawingItem[]>(() => {
    try {
      const saved = localStorage.getItem(`chart_drawings_${symbol}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [currentDrawing, setCurrentDrawing] = useState<DrawingItem | null>(null);
  const [textInputPos, setTextInputPos] = useState<Point | null>(null);
  const [textInputValue, setTextInputValue] = useState<string>('');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef<boolean>(false);

  // Save drawings when changed
  useEffect(() => {
    try {
      localStorage.setItem(`chart_drawings_${symbol}`, JSON.stringify(drawings));
    } catch {}
  }, [drawings, symbol]);

  // Load drawings on symbol change
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`chart_drawings_${symbol}`);
      setDrawings(saved ? JSON.parse(saved) : []);
    } catch {
      setDrawings([]);
    }
    setCurrentDrawing(null);
    setTextInputPos(null);
  }, [symbol]);

  // Canvas render function
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    const allDrawings = currentDrawing ? [...drawings, currentDrawing] : drawings;

    for (const item of allDrawings) {
      ctx.strokeStyle = item.color;
      ctx.fillStyle = item.color;
      ctx.lineWidth = item.lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (item.type === 'trendline' && item.points.length >= 2) {
        const [p1, p2] = item.points;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        // End circles
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, 3, 0, Math.PI * 2);
        ctx.arc(p2.x, p2.y, 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (item.type === 'horizontal' && item.points.length >= 1) {
        const p = item.points[0];
        ctx.beginPath();
        ctx.setLineDash([5, 4]);
        ctx.moveTo(0, p.y);
        ctx.lineTo(containerWidth, p.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label tag
        ctx.fillStyle = item.color;
        ctx.fillRect(containerWidth - 65, p.y - 10, 60, 20);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.fillText('S/R Level', containerWidth - 60, p.y + 4);
      } else if (item.type === 'ray' && item.points.length >= 2) {
        const [p1, p2] = item.points;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const angle = Math.atan2(dy, dx);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        // Arrow head
        const arrowLen = 10;
        ctx.beginPath();
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(p2.x - arrowLen * Math.cos(angle - Math.PI / 6), p2.y - arrowLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(p2.x - arrowLen * Math.cos(angle + Math.PI / 6), p2.y - arrowLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      } else if (item.type === 'rectangle' && item.points.length >= 2) {
        const [p1, p2] = item.points;
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x);
        const h = Math.abs(p2.y - p1.y);

        ctx.fillStyle = `${item.color}20`; // 12% opacity fill
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      } else if (item.type === 'brush' && item.points.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(item.points[0].x, item.points[0].y);
        for (let i = 1; i < item.points.length; i++) {
          ctx.lineTo(item.points[i].x, item.points[i].y);
        }
        ctx.stroke();
      } else if (item.type === 'fibonacci' && item.points.length >= 2) {
        const [p1, p2] = item.points;
        const height = p2.y - p1.y;

        FIB_LEVELS.forEach(({ level, label, color }) => {
          const y = p1.y + height * level;
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(containerWidth, y);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = color;
          ctx.font = '10px Inter, monospace';
          ctx.fillText(label, 12, y - 4);
        });
      } else if (item.type === 'measure' && item.points.length >= 2) {
        const [p1, p2] = item.points;
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x);
        const h = Math.abs(p2.y - p1.y);

        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);

        // Diagonal
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Measurement box
        const dy = Math.abs(p2.y - p1.y);
        const dx = Math.abs(p2.x - p1.x);
        const label = `ΔY: ${dy.toFixed(0)}px | ΔX: ${dx.toFixed(0)}px`;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(p2.x + 8, p2.y - 12, 130, 24);
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 10px Inter, monospace';
        ctx.fillText(label, p2.x + 14, p2.y + 4);
      } else if (item.type === 'text' && item.points.length >= 1 && item.text) {
        const p = item.points[0];
        ctx.font = 'bold 12px Inter, sans-serif';
        const textMetrics = ctx.measureText(item.text);
        const padding = 6;

        ctx.fillStyle = isDark ? '#1e293b' : '#f1f5f9';
        ctx.fillRect(p.x - padding, p.y - 14, textMetrics.width + padding * 2, 22);
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x - padding, p.y - 14, textMetrics.width + padding * 2, 22);

        ctx.fillStyle = item.color;
        ctx.fillText(item.text, p.x, p.y + 2);
      }
    }

    ctx.restore();
  }, [drawings, currentDrawing, containerWidth, isDark]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerWidth * dpr;
    canvas.height = containerHeight * dpr;
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${containerHeight}px`;
    renderCanvas();
  }, [containerWidth, containerHeight, renderCanvas]);

  // Pointer event handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeTool === 'cursor') return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const point: Point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    if (activeTool === 'text') {
      setTextInputPos(point);
      return;
    }

    isDrawingRef.current = true;

    if (activeTool === 'horizontal') {
      const newItem: DrawingItem = {
        id: `drw_${Date.now()}`,
        type: 'horizontal',
        color: activeColor,
        lineWidth,
        points: [point],
      };
      setDrawings((prev) => [...prev, newItem]);
      isDrawingRef.current = false;
      return;
    }

    setCurrentDrawing({
      id: `drw_${Date.now()}`,
      type: activeTool,
      color: activeColor,
      lineWidth,
      points: [point],
    });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !currentDrawing) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const point: Point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };

    if (activeTool === 'brush') {
      setCurrentDrawing((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          points: [...prev.points, point],
        };
      });
    } else {
      setCurrentDrawing((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          points: [prev.points[0], point],
        };
      });
    }
  };

  const handlePointerUp = () => {
    if (!isDrawingRef.current || !currentDrawing) return;
    isDrawingRef.current = false;

    if (currentDrawing.points.length >= 2) {
      setDrawings((prev) => [...prev, currentDrawing]);
    }
    setCurrentDrawing(null);
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInputPos && textInputValue.trim()) {
      const newItem: DrawingItem = {
        id: `drw_${Date.now()}`,
        type: 'text',
        color: activeColor,
        lineWidth: 1,
        points: [textInputPos],
        text: textInputValue.trim(),
      };
      setDrawings((prev) => [...prev, newItem]);
    }
    setTextInputPos(null);
    setTextInputValue('');
  };

  const handleUndo = () => {
    setDrawings((prev) => prev.slice(0, -1));
  };

  const handleClearAll = () => {
    setDrawings([]);
    try {
      localStorage.removeItem(`chart_drawings_${symbol}`);
    } catch {}
  };

  const toolButtons: Array<{ id: DrawingTool; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'cursor', label: 'Cursor (Pan / Zoom)', icon: MousePointer },
    { id: 'trendline', label: 'Trend Line', icon: TrendingUp },
    { id: 'horizontal', label: 'Horizontal Line (S/R)', icon: Minus },
    { id: 'ray', label: 'Arrow / Ray', icon: ArrowUpRight },
    { id: 'rectangle', label: 'Zone / Order Block', icon: Square },
    { id: 'brush', label: 'Brush (Freehand)', icon: Paintbrush },
    { id: 'fibonacci', label: 'Fib Retracement', icon: AlignJustify },
    { id: 'text', label: 'Text Note', icon: Type },
    { id: 'measure', label: 'Measure Range', icon: Ruler },
  ];

  return (
    <>
      {/* ── Vertical Drawing Toolbar (Docked Left, TradingView Style) ────────────────── */}
      <div
        className={`absolute left-2 top-3 z-30 flex flex-col items-center gap-1 p-1.5 rounded-2xl shadow-2xl border backdrop-blur-md transition-all ${
          isDark
            ? 'bg-[#0f111a]/90 border-slate-800 text-slate-300 shadow-black/60'
            : 'bg-white/95 border-slate-200 text-slate-700 shadow-slate-300/50'
        }`}
      >
        {toolButtons.map(({ id, label, icon: Icon }) => {
          const isActive = activeTool === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                setActiveTool(id);
                setTextInputPos(null);
              }}
              title={label}
              className={`relative p-2 rounded-xl text-xs transition-all cursor-pointer group flex items-center justify-center ${
                isActive
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-500/25 scale-105'
                  : isDark
                  ? 'hover:bg-slate-800/80 hover:text-white'
                  : 'hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="w-4 h-4" />
              {/* Tooltip */}
              <span
                className={`absolute left-full ml-2.5 px-2 py-1 rounded-md text-[10px] font-semibold whitespace-nowrap shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 ${
                  isDark ? 'bg-slate-900 border border-slate-700 text-white' : 'bg-slate-800 text-white'
                }`}
              >
                {label}
              </span>
            </button>
          );
        })}

        <div className={`w-5 h-px my-0.5 ${isDark ? 'bg-slate-800' : 'bg-slate-200'}`} />

        {/* Color Palette Toggle */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowColorPicker((prev) => !prev)}
            title="Line Color & Settings"
            className={`p-2 rounded-xl transition cursor-pointer flex items-center justify-center relative group ${
              isDark ? 'hover:bg-slate-800/80' : 'hover:bg-slate-100'
            }`}
          >
            <div
              className="w-4 h-4 rounded-full border border-white/40 shadow-sm"
              style={{ backgroundColor: activeColor }}
            />
            <span
              className={`absolute left-full ml-2.5 px-2 py-1 rounded-md text-[10px] font-semibold whitespace-nowrap shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 ${
                isDark ? 'bg-slate-900 border border-slate-700 text-white' : 'bg-slate-800 text-white'
              }`}
            >
              Drawing Color
            </span>
          </button>

          {showColorPicker && (
            <div
              className={`absolute left-full ml-2.5 top-0 p-2.5 rounded-xl shadow-2xl border backdrop-blur-lg z-50 flex flex-col gap-2 min-w-[130px] ${
                isDark ? 'bg-slate-900/95 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'
              }`}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Color</span>
              <div className="grid grid-cols-4 gap-1.5">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => {
                      setActiveColor(c.value);
                      setShowColorPicker(false);
                    }}
                    className="w-5 h-5 rounded-full border border-white/20 transition-transform hover:scale-110 flex items-center justify-center cursor-pointer"
                    style={{ backgroundColor: c.value }}
                  >
                    {activeColor === c.value && <Check className="w-3 h-3 text-black font-bold" />}
                  </button>
                ))}
              </div>

              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">Width</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setLineWidth(w)}
                    className={`flex-1 py-0.5 rounded text-[10px] font-bold cursor-pointer transition ${
                      lineWidth === w
                        ? 'bg-blue-600 text-white'
                        : isDark
                        ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {w}px
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Undo Button */}
        <button
          type="button"
          onClick={handleUndo}
          disabled={drawings.length === 0}
          title="Undo last drawing"
          className={`p-2 rounded-xl transition cursor-pointer flex items-center justify-center group relative disabled:opacity-40 disabled:cursor-not-allowed ${
            isDark ? 'hover:bg-slate-800/80 text-slate-300' : 'hover:bg-slate-100 text-slate-700'
          }`}
        >
          <Undo2 className="w-4 h-4" />
          <span
            className={`absolute left-full ml-2.5 px-2 py-1 rounded-md text-[10px] font-semibold whitespace-nowrap shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 ${
              isDark ? 'bg-slate-900 border border-slate-700 text-white' : 'bg-slate-800 text-white'
            }`}
          >
            Undo (Ctrl+Z)
          </span>
        </button>

        {/* Clear All Button */}
        <button
          type="button"
          onClick={handleClearAll}
          disabled={drawings.length === 0}
          title="Clear all drawings"
          className={`p-2 rounded-xl transition cursor-pointer flex items-center justify-center group relative disabled:opacity-40 disabled:cursor-not-allowed ${
            isDark ? 'hover:bg-rose-500/20 text-rose-400' : 'hover:bg-rose-50 text-rose-600'
          }`}
        >
          <Trash2 className="w-4 h-4" />
          <span
            className={`absolute left-full ml-2.5 px-2 py-1 rounded-md text-[10px] font-semibold whitespace-nowrap shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 ${
              isDark ? 'bg-slate-900 border border-slate-700 text-rose-300' : 'bg-slate-800 text-rose-200'
            }`}
          >
            Clear All
          </span>
        </button>
      </div>

      {/* ── Interactive Drawing Canvas Overlay ─────────────────────────────── */}
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={`absolute inset-0 z-20 touch-none ${
          activeTool === 'cursor' ? 'pointer-events-none' : 'pointer-events-auto cursor-crosshair'
        }`}
      />

      {/* ── Inline Text Input Modal ────────────────────────────────────────── */}
      {textInputPos && (
        <form
          onSubmit={handleTextSubmit}
          className={`absolute z-40 p-2 rounded-xl shadow-2xl border backdrop-blur-md flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-150 ${
            isDark ? 'bg-slate-900/95 border-slate-700 text-white' : 'bg-white/95 border-slate-200 text-slate-800'
          }`}
          style={{
            left: Math.min(textInputPos.x, containerWidth - 220),
            top: Math.min(textInputPos.y, containerHeight - 60),
          }}
        >
          <input
            type="text"
            autoFocus
            value={textInputValue}
            onChange={(e) => setTextInputValue(e.target.value)}
            placeholder="Type note label..."
            className={`px-2.5 py-1 text-xs rounded-lg border outline-none font-medium w-40 ${
              isDark
                ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500'
                : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400'
            }`}
          />
          <button
            type="submit"
            className="px-2.5 py-1 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white cursor-pointer transition shadow-sm"
          >
            OK
          </button>
          <button
            type="button"
            onClick={() => setTextInputPos(null)}
            className="px-1.5 py-1 text-xs rounded-lg text-slate-400 hover:text-white cursor-pointer"
          >
            ✕
          </button>
        </form>
      )}
    </>
  );
};

export default ChartDrawingTools;
