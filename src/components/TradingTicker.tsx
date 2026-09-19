const TICKER_TEXT = "Don't Take a Big Break From Trading";

// Three voices of the same line. Only the third is coloured — one accent per
// cycle keeps the marquee from turning into a rainbow.
const TICKER_STYLES = [
  { className: 'font-display font-bold uppercase tracking-tight text-slate-100/90' },
  { className: 'ticker-font-elegant italic font-medium text-slate-400' },
  { className: 'ticker-font-future font-semibold uppercase tracking-[0.28em] bg-gradient-to-r from-violet-300 via-violet-400 to-indigo-300 bg-clip-text text-transparent' },
];

function TickerUnit() {
  return (
    <div className="flex shrink-0 items-center">
      {TICKER_STYLES.map((s, i) => (
        <div key={i} className="flex shrink-0 items-center">
          <span className={`whitespace-nowrap text-xl sm:text-2xl lg:text-[1.75rem] leading-tight ${s.className}`}>
            {TICKER_TEXT}
          </span>
          <span className="mx-8 sm:mx-12 lg:mx-16 text-lg sm:text-xl text-violet-400/60 select-none" aria-hidden="true">
            ✦
          </span>
        </div>
      ))}
    </div>
  );
}

export default function TradingTicker() {
  return (
    // No hard top/bottom rules: the band is a faint wash that the horizontal
    // ticker-mask fades out at both ends, so it reads as depth, not a box.
    <div className="relative w-full overflow-hidden py-5 bg-gradient-to-b from-white/[0.045] to-transparent ticker-mask" aria-hidden="true">
      <div className="ticker-track flex w-max">
        <TickerUnit />
        <TickerUnit />
      </div>
    </div>
  );
}
