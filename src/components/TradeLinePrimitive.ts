import {
  ISeriesPrimitive,
  IPrimitivePaneView,
  IPrimitivePaneRenderer,
  Time,
  SeriesAttachedParameter,
} from 'lightweight-charts';

export interface TradeLineOptions {
  id: string;
  entryTime: Time;
  entryPrice: number;
  exitTime: Time;
  exitPrice: number;
  isWin: boolean;
  isOpen?: boolean;
  profit?: number;
  lotSize?: number;
  type?: 'Buy' | 'Sell';
  note?: string;
  stackOffset?: number;
}

interface HitBox { x: number; y: number; w: number; h: number; }

class TradeLineRenderer implements IPrimitivePaneRenderer {
  private _options: TradeLineOptions;
  private _p1: { x: number; y: number } | null = null;
  private _p2: { x: number; y: number } | null = null;
  public noteIconHitbox: HitBox | null = null;

  constructor(options: TradeLineOptions) { this._options = options; }

  update(p1: { x: number; y: number } | null, p2: { x: number; y: number } | null) {
    this._p1 = p1; this._p2 = p2;
  }

  draw(target: any) {
    target.useBitmapCoordinateSpace((scope: any) => {
      if (!this._p1 || !this._p2) return;
      const ctx = scope.context as CanvasRenderingContext2D;
      const pr = scope.horizontalPixelRatio;
      const vr = scope.verticalPixelRatio;
      const x1 = Math.round(this._p1.x * pr);
      const y1 = Math.round(this._p1.y * vr);
      const x2 = Math.round(this._p2.x * pr);
      const y2 = Math.round(this._p2.y * vr);
      const isBuy = this._options.type === 'Buy';
      const lineColor = isBuy ? '#3b82f6' : '#f97316';
      const isOpen = this._options.isOpen;

      ctx.save();

      // 1. Bezier curve connecting entry to exit
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      const cpx = x1 + (x2 - x1) * 0.5;
      ctx.bezierCurveTo(cpx, y1, cpx, y2, x2, y2);
      ctx.strokeStyle = isOpen ? 'rgba(148,163,184,0.45)' : lineColor + 'bb';
      ctx.lineWidth = 1.5 * pr;
      ctx.setLineDash(isOpen ? [5 * pr, 4 * pr] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      // 2. Entry hollow ring
      const er = 5 * pr;
      ctx.beginPath();
      ctx.arc(x1, y1, er, 0, Math.PI * 2);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2 * pr;
      ctx.stroke();
      ctx.fillStyle = '#09090b';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x1, y1, 2 * pr, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();

      // 3. Exit circle
      if (!isOpen) {
        const xr = 4 * pr;
        const xCol = (this._options.profit ?? 0) >= 0 ? '#10b981' : '#ef4444';
        ctx.beginPath();
        ctx.arc(x2, y2, xr, 0, Math.PI * 2);
        ctx.strokeStyle = xCol;
        ctx.lineWidth = 2 * pr;
        ctx.stroke();
        ctx.fillStyle = '#09090b';
        ctx.fill();
      }

      // 4. Lot-size badge
      const stackOff = (this._options.stackOffset || 0) * 26 * vr;
      const lotText = String(this._options.lotSize ?? 1);
      ctx.font = `700 ${11 * pr}px Inter,ui-sans-serif,sans-serif`;
      const tw = ctx.measureText(lotText).width;
      const bpx = 8 * pr;
      const bw = tw + bpx * 2;
      const bh = 18 * pr;
      const bx = x1 - bw / 2;
      const by = y1 + 14 * vr + stackOff;
      const br = 4 * pr;

      ctx.fillStyle = 'rgba(15,23,42,0.92)';
      ctx.beginPath();
      rrect(ctx, bx, by, bw, bh, br);
      ctx.fill();

      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(lotText, x1, by + bh / 2);

      // colored underline bar below badge
      const barH = 3 * vr;
      const barW = bw * 0.6;
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      rrect(ctx, x1 - barW / 2, by + bh + vr, barW, barH, barH / 2);
      ctx.fill();

      // 5. P&L label right of exit
      if (!isOpen && this._options.profit !== undefined) {
        const pl = this._options.profit;
        const plTxt = (pl >= 0 ? '+' : '-') + '$' + Math.abs(pl).toFixed(2);
        const plCol = pl >= 0 ? '#10b981' : '#ef4444';
        ctx.font = `600 ${11 * pr}px Inter,ui-sans-serif,sans-serif`;
        ctx.fillStyle = plCol;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(plTxt, x2 + 10 * pr, y2);
      }

      // 6. Note chat-bubble icon
      this.noteIconHitbox = null;
      if (this._options.note) {
        const iso = 14 * pr;
        const nx = x1 + bw / 2 + 7 * pr;
        const ny = by + bh / 2;
        ctx.fillStyle = 'rgba(59,130,246,0.92)';
        ctx.beginPath();
        rrect(ctx, nx - iso / 2, ny - iso / 2, iso, iso, 3 * pr);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(nx - 3 * pr, ny + iso / 2);
        ctx.lineTo(nx - 6 * pr, ny + iso / 2 + 4 * pr);
        ctx.lineTo(nx + 2 * pr, ny + iso / 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.arc(nx + i * 4 * pr, ny - pr, 1.2 * pr, 0, Math.PI * 2);
          ctx.fill();
        }
        this.noteIconHitbox = {
          x: (nx - iso / 2) / pr, y: (ny - iso / 2) / vr,
          w: iso / pr, h: iso / vr,
        };
      }

      ctx.restore();
    });
  }
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

class TradeLinePaneView implements IPrimitivePaneView {
  private _source: TradeLinePrimitive;
  private _renderer: TradeLineRenderer;
  constructor(source: TradeLinePrimitive) {
    this._source = source;
    this._renderer = new TradeLineRenderer(source.options);
  }
  zOrder(): 'top' { return 'top'; }
  update() {
    const s = this._source.series;
    const ts = this._source.chart?.timeScale();
    if (!s || !ts) return;
    const ex = ts.timeToCoordinate(this._source.options.entryTime);
    const exitX = ts.timeToCoordinate(this._source.options.exitTime);
    if (ex === null || exitX === null) { this._renderer.update(null, null); return; }
    const ey = s.priceToCoordinate(this._source.options.entryPrice);
    const exitY = s.priceToCoordinate(this._source.options.exitPrice);
    if (ey === null || exitY === null) { this._renderer.update(null, null); return; }
    this._renderer.update({ x: ex as number, y: ey }, { x: exitX as number, y: exitY });
  }
  renderer() { return this._renderer; }
}

export class TradeLinePrimitive implements ISeriesPrimitive {
  public options: TradeLineOptions;
  public chart: any;
  public series: any;
  private _paneViews: TradeLinePaneView[];
  constructor(options: TradeLineOptions) {
    this.options = options;
    this._paneViews = [new TradeLinePaneView(this)];
  }
  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart; this.series = param.series;
    this._paneViews.forEach(v => v.update());
  }
  detached() { this.chart = undefined; this.series = undefined; }
  paneViews() { return this._paneViews; }
  updateAllViews() { this._paneViews.forEach(v => v.update()); }
  hitTestNote(point: { x: number; y: number }): boolean {
    const hb = this._paneViews[0].renderer().noteIconHitbox;
    if (!hb) return false;
    const p = 6;
    return point.x >= hb.x - p && point.x <= hb.x + hb.w + p &&
           point.y >= hb.y - p && point.y <= hb.y + hb.h + p;
  }
}
