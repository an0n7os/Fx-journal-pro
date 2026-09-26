import { Sparkles } from 'lucide-react';

/**
 * Stand-in for a Pro-only screen on the free plan.
 *
 * The server refuses these features outright, so rendering the real screen to
 * a free user walks them through a whole setup flow only to end at a 403. This
 * says what the feature does and where to get it instead.
 *
 * Shared rather than written per tab: MT5 Sync, Live Chart and AI Mentor each
 * had their own version, and they had drifted — AI Mentor's carried a blue
 * chip, an emerald glow and a violet/fuchsia/indigo gradient button, none of
 * which appear anywhere else in the product. Three screens that exist to sell
 * the same ₹399 plan should not look like three different products.
 */
export default function ProFeaturePanel({
  title,
  blurb,
  onUpgrade,
  price = 499,
}: {
  title: string;
  blurb: string;
  onUpgrade: () => void;
  price?: number;
}) {
  return (
    <div className="dx-panel relative overflow-hidden p-5 sm:p-8 md:p-10 text-center">
      {/* One ambient glow, in the product's accent. */}
      <div className="pointer-events-none absolute -top-24 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-violet-600/10 blur-3xl" />

      <div className="relative z-10">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300">
          <Sparkles className="h-3 w-3" /> Pro feature
        </span>

        <h2 className="mt-4 font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
          {title}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          {blurb}
        </p>

        <button
          onClick={onUpgrade}
          className="dx-upgrade mt-6 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-bold"
        >
          Upgrade to Pro — ₹{price}/month
        </button>
      </div>
    </div>
  );
}
