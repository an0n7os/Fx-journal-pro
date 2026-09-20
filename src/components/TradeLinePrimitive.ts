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
      ctx.strokeStyle = isOpen ? 'rgba(148,163,184,0.45)' : lineColor + 'cc';
      ctx.lineWidth = 1.8 * pr;
      ctx.setLineDash(isOpen ? [5 * pr, 4 * pr] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      // 2. Entry hollow ring with inner dot
      const er = 5.5 * pr;
      ctx.beginPath();
      ctx.arc(x1, y1, er, 0, Math.PI * 2);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2 * pr;
      ctx.stroke();
      ctx.fillStyle = '#060913';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x1, y1, 2.5 * pr, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();

      // 3. Arrowhead at Exit point pointing along the curve
      const angle = Math.atan2(y2 - y1, x2 - cpx);
      const headLen = 8 * pr;
      ctx.fillStyle = isOpen ? 'rgba(148,163,184,0.85)' : lineColor;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - headLen * Math.cos(angle - Math.PI / 6),
        y2 - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        x2 - headLen * Math.cos(angle + Math.PI / 6),
        y2 - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();

      // 4. Lot-size badge below entry
      const stackOff = (this._options.stackOffset || 0) * 26 * vr;
      const lotText = String(this._options.lotSize ?? 1);
      ctx.font = `700 ${10.5 * pr}px Inter,ui-sans-serif,sans-serif`;
      const tw = ctx.measureText(lotText).width;
      const bpx = 7 * pr;
      const bw = Math.max(tw + bpx * 2, 20 * pr);
      const bh = 17 * vr;
      const bx = x1 - bw / 2;
      const by = y1 + 12 * vr + stackOff;
      const br = 4 * pr;

      // Dark card with subtle border
      ctx.fillStyle = 'rgba(6, 9, 19, 0.94)';
      ctx.beginPath();
      rrect(ctx, bx, by, bw, bh, br);
      ctx.fill();
      ctx.strokeStyle = lineColor + '88';
      ctx.lineWidth = 1 * pr;
      ctx.stroke();

      ctx.fillStyle = '#f1f5f9';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(lotText, x1, by + bh / 2);

      // Colored underline bar below lot badge
      const barH = 2.5 * vr;
      const barW = bw * 0.75;
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      rrect(ctx, x1 - barW / 2, by + bh + 1.5 * vr, barW, barH, barH / 2);
      ctx.fill();

      // 5. P&L label pill badge at exit (e.g. -$17.12, +$3.23)
      if (!isOpen && this._options.profit !== undefined) {
        const pl = this._options.profit;
        const plTxt = (pl >= 0 ? '+' : '-') + '$' + Math.abs(pl).toFixed(2);
        const isProfit = pl >= 0;
        const plCol = isProfit ? '#34d399' : '#f87171';
        const borderCol = isProfit ? 'rgba(52, 211, 153, 0.45)' : 'rgba(248, 113, 113, 0.45)';

        ctx.font = `700 ${10.5 * pr}px Inter,ui-sans-serif,sans-serif`;
        const plWidth = ctx.measureText(plTxt).width;
        const padX = 6 * pr;
        const pillW = plWidth + padX * 2;
        const pillH = 17 * vr;
        const pillX = x2 + 7 * pr;
        const pillY = y2 - pillH / 2;
        const pillR = 4 * pr;

        ctx.fillStyle = 'rgba(6, 9, 19, 0.94)';
        ctx.beginPath();
        rrect(ctx, pillX, pillY, pillW, pillH, pillR);
        ctx.fill();
        ctx.strokeStyle = borderCol;
        ctx.lineWidth = 1 * pr;
        ctx.stroke();

        ctx.fillStyle = plCol;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(plTxt, pillX + pillW / 2, pillY + pillH / 2);
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
    let ex = ts.timeToCoordinate(this._source.options.entryTime);
    let exitX = ts.timeToCoordinate(this._source.options.exitTime);
    if (ex === null || exitX === null) { this._renderer.update(null, null); return; }
    const ey = s.priceToCoordinate(this._source.options.entryPrice);
    const exitY = s.priceToCoordinate(this._source.options.exitPrice);
    if (ey === null || exitY === null) { this._renderer.update(null, null); return; }
    // Ensure exit point is visibly separated from entry so curve and arrowhead are clear
    if (Math.abs(exitX - ex) < 22) {
      exitX = (ex as number) + 28;
    }
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
