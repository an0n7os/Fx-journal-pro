import React from 'react';

interface LogoProps {
  className?: string;
  /** Height of the mark, in pixels. The wordmark and the gap follow from it. */
  size?: number | string;
  wordmarkHeight?: number;
  /** Overrides the proportional gap. A Tailwind class, e.g. "gap-2". */
  gap?: string;
  iconOnly?: boolean;
  wordmarkOnly?: boolean;
}

/**
 * The lockup's proportions, measured off the cropped artwork rather than
 * guessed.
 *
 * Both SVGs are cropped to their ink, so these ratios describe the drawing
 * itself. Rasterising each one and scanning it row by row gives:
 *
 *   Wordmark  1795.07 x 212.54  cap line at row 0, baseline at 96.6% of the
 *                               box, the last 3.4% being the J's descender.
 *                               So the box height IS the cap height, and
 *                               centring the box centres the capitals.
 *   Mark       707.23 x 725.86  ink fills the box edge to edge.
 *
 * WORDMARK_RATIO is therefore a true cap-height-to-mark-height ratio. GAP_RATIO
 * scales the space with the mark: a fixed gap-1.5 looked right at one size and
 * wrong at every other, because optical spacing is proportional, not absolute.
 */
const WORDMARK_RATIO = 0.62;
const GAP_RATIO = 0.2;

/**
 * Every dimension is emitted as a CSS variable multiplied by `--logo-scale`,
 * which `.dx-logo` in index.css drops below the sm breakpoint.
 *
 * The sizes are chosen by the caller in pixels, so a media query could not
 * reach them while they were inline `height` values — and reading the viewport
 * width in JavaScript would paint the wrong size for a frame on every load,
 * which is the same mistake the theme-dependent wordmark used to make. One
 * variable keeps the mark, the wordmark and the gap in step: scaling them
 * separately is what throws a lockup out of proportion.
 */
const scaled = (px: number) => `calc(${px}px * var(--logo-scale, 1))`;

/**
 * The wordmark, in whichever theme is active.
 *
 * It used to point at "Wordmark WhitePNG.png" in every case, so the lettering
 * was white on a white page in light mode — invisible. Both variants are now
 * rendered and CSS shows one, rather than reading the theme in JavaScript:
 * a state read would paint the wrong wordmark for a frame on every load.
 *
 * SVG rather than the PNGs so it stays crisp at any size, and because the two
 * files differ only in one fill — Wordmark-White.svg is generated from
 * Wordmark.svg.
 */
function Wordmark({ height, className = '' }: { height: number; className?: string }) {
  // maxWidth lets the wordmark give way when the row is narrower than it is:
  // at 375px the landing navbar was 411px wide, and since the page clips
  // overflow-x the hamburger ended up past the right edge with no way to
  // scroll to it — the whole mobile menu was unreachable. With object-contain
  // the artwork scales down inside the shortened box instead of being cut.
  const style = { height: scaled(height), width: 'auto', maxWidth: '100%' };
  return (
    <>
      <img
        src="/Wordmark.svg"
        alt="FX Journal Pro"
        className={`dx-logo object-contain select-none min-w-0 block dark:hidden ${className}`}
        style={style}
      />
      {/*
        Both variants carry the real alt text, and neither is aria-hidden:
        exactly one of them is ever `display: block`, and a display:none image
        is out of the accessibility tree, so there is no double announcement.
        Marking this one aria-hidden instead left the logo link with no
        accessible name wherever the white variant is the visible one.
      */}
      <img
        src="/Wordmark-White.svg"
        alt="FX Journal Pro"
        className={`dx-logo object-contain select-none min-w-0 hidden dark:block ${className}`}
        style={style}
      />
    </>
  );
}

export function Logo({
  className = '',
  size = 30,
  wordmarkHeight,
  gap,
  iconOnly = false,
  wordmarkOnly = false
}: LogoProps) {
  const numericSize = typeof size === 'number' ? size : 30;
  const iconSize = numericSize;
  const calcWordmarkHeight = wordmarkHeight ?? Math.round(numericSize * WORDMARK_RATIO);
  const calcGap = Math.round(numericSize * GAP_RATIO);

  // The mark is a single violet, which reads on both themes, so it needs no
  // second variant. It also replaces /IconPNG.png, which no longer exists —
  // every logo in the app was rendering a broken image.
  const icon = (
    <img
      src="/Icon.svg"
      alt="FX Journal Pro Icon"
      className="dx-logo object-contain select-none shrink-0"
      style={{ height: scaled(iconSize), width: 'auto' }}
    />
  );

  if (iconOnly) {
    return React.cloneElement(icon, {
      className: `dx-logo object-contain select-none shrink-0 ${className}`,
    });
  }

  if (wordmarkOnly) {
    return <Wordmark height={calcWordmarkHeight} className={className} />;
  }

  return (
    <div
      className={`dx-logo flex items-center ${gap ?? ''} select-none min-w-0 ${className}`}
      style={gap ? undefined : { gap: scaled(calcGap) }}
    >
      {icon}
      <Wordmark height={calcWordmarkHeight} />
    </div>
  );
}

export default Logo;
