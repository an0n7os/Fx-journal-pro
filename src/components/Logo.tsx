import React from 'react';

interface LogoProps {
  className?: string;
  size?: number | string;
  variant?: 'dark' | 'light' | 'color';
}

export function Logo({ className = '', size = '100%', variant = 'color' }: LogoProps) {
  // Use rich dark navy/slate colors for dark/color variants
  const darkColor = '#0f1e36'; // Elegant dark blue from user's logo
  const greenColor = '#10b981'; // Emerald green accent
  
  const strokeColor = variant === 'light' ? '#ffffff' : darkColor;
  const candleGreen = variant === 'light' ? '#34d399' : greenColor;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`select-none ${className}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* 
        1. TOP-LEFT HALF & DIAGONAL SLASH 
        Starts with left-edge border, goes up, curves into top-edge, curves into top-right-edge,
        then curves in and sweeps down-left diagonally, looping at the bottom left.
      */}
      <path
        d="M 18 75 
           L 18 18 
           A 8 8 0 0 1 26 10 
           L 80 10 
           A 8 8 0 0 1 88 18 
           L 88 34
           C 88 38, 86 40, 83 42
           L 23 82
           C 20 84, 18 82, 18 75 Z"
        stroke={strokeColor}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 
        2. BOTTOM-RIGHT HALF
        Starts with left spine base, curves down-left, forms bottom-left corner,
        goes right, curves up-right corner, and goes up along the right edge.
      */}
      <path
        d="M 28 85
           C 22 85, 18 87, 18 90
           A 8 8 0 0 0 26 98
           L 80 98
           A 8 8 0 0 0 88 90
           L 88 44"
        stroke={strokeColor}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 
        3. NOTEBOOK SPINE LINE
        A straight vertical line representing the spine of the journal.
      */}
      <line
        x1="28"
        y1="10"
        x2="28"
        y2="98"
        stroke={strokeColor}
        strokeWidth="4"
        strokeLinecap="round"
      />

      {/* 
        4. CANDLESTICK 1 (Leftmost)
        Shadow (thin vertical line) & Body (hollow rect)
      */}
      <line
        x1="38"
        y1="56"
        x2="38"
        y2="72"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect
        x="35"
        y="60"
        width="6"
        height="8"
        rx="1"
        fill={variant === 'light' ? '#1e293b' : '#ffffff'}
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* 
        5. CANDLESTICK 2
        Shadow (thin vertical line) & Body (hollow rect)
      */}
      <line
        x1="50"
        y1="44"
        x2="50"
        y2="66"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect
        x="47"
        y="49"
        width="6"
        height="12"
        rx="1"
        fill={variant === 'light' ? '#1e293b' : '#ffffff'}
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* 
        6. CANDLESTICK 3
        Shadow (thin vertical line) & Body (hollow rect)
      */}
      <line
        x1="62"
        y1="32"
        x2="62"
        y2="54"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect
        x="59"
        y="37"
        width="6"
        height="12"
        rx="1"
        fill={variant === 'light' ? '#1e293b' : '#ffffff'}
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* 
        7. CANDLESTICK 4 (Tallest, filled Green)
        Shadow (thin vertical line) & Body (filled green)
      */}
      <line
        x1="74"
        y1="20"
        x2="74"
        y2="46"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect
        x="71"
        y="25"
        width="6"
        height="16"
        rx="1"
        fill={candleGreen}
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export default Logo;
