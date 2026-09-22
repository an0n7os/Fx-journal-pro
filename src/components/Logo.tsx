import React from 'react';

interface LogoProps {
  className?: string;
  size?: number | string;
  wordmarkHeight?: number;
  gap?: string;
  iconOnly?: boolean;
  wordmarkOnly?: boolean;
}

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
  const style = { height: `${height}px`, width: 'auto' };
  return (
    <>
      <img
        src="/Wordmark.svg"
        alt="FX Journal Pro"
        className={`object-contain select-none shrink-0 block dark:hidden ${className}`}
        style={style}
      />
      <img
        src="/Wordmark-White.svg"
        alt=""
        aria-hidden="true"
        className={`object-contain select-none shrink-0 hidden dark:block ${className}`}
        style={style}
      />
    </>
  );
}

export function Logo({
  className = '',
  size = 36,
  wordmarkHeight,
  gap = 'gap-1',
  iconOnly = false,
  wordmarkOnly = false
}: LogoProps) {
  const numericSize = typeof size === 'number' ? size : 36;
  const iconSize = numericSize;
  const calcWordmarkHeight = wordmarkHeight ?? Math.round(numericSize * 0.73);

  // The mark is a single violet, which reads on both themes, so it needs no
  // second variant. It also replaces /IconPNG.png, which no longer exists —
  // every logo in the app was rendering a broken image.
  const icon = (
    <img
      src="/Icon.svg"
      alt="FX Journal Pro Icon"
      className="object-contain select-none shrink-0"
      style={{ height: `${iconSize}px`, width: 'auto' }}
    />
  );

  if (iconOnly) {
    return React.cloneElement(icon, {
      className: `object-contain select-none shrink-0 ${className}`,
    });
  }

  if (wordmarkOnly) {
    return <Wordmark height={calcWordmarkHeight} className={className} />;
  }

  return (
    <div className={`flex items-center ${gap} select-none shrink-0 ${className}`}>
      {icon}
      <Wordmark height={calcWordmarkHeight} />
    </div>
  );
}

export default Logo;
