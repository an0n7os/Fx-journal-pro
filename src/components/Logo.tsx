import React from 'react';

interface LogoProps {
  className?: string;
  size?: number | string;
  wordmarkHeight?: number;
  gap?: string;
  iconOnly?: boolean;
  wordmarkOnly?: boolean;
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

  if (iconOnly) {
    return (
      <img
        src="/IconPNG.png"
        alt="FX Journal Pro Icon"
        className={`object-contain select-none shrink-0 ${className}`}
        style={{ height: `${iconSize}px`, width: 'auto' }}
      />
    );
  }

  if (wordmarkOnly) {
    return (
      <img
        src="/Wordmark WhitePNG.png"
        alt="FX Journal Pro"
        className={`object-contain select-none shrink-0 ${className}`}
        style={{ height: `${calcWordmarkHeight}px`, width: 'auto' }}
      />
    );
  }

  return (
    <div className={`flex items-center ${gap} select-none shrink-0 ${className}`}>
      <img
        src="/IconPNG.png"
        alt="FX Journal Pro Icon"
        className="object-contain shrink-0"
        style={{ height: `${iconSize}px`, width: 'auto' }}
      />
      <img
        src="/Wordmark WhitePNG.png"
        alt="FX Journal Pro"
        className="object-contain shrink-0"
        style={{ height: `${calcWordmarkHeight}px`, width: 'auto' }}
      />
    </div>
  );
}

export default Logo;
