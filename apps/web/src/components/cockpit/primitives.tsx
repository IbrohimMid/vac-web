// Cockpit primitives — ported from vacweb/ui.jsx (Stage A).
// Glyphs + reusable visual elements consumed by Topbar, Sidebar, Rail, and
// the surface views. Severity grammar matches docs/ux-grammar.md.

import type { CSSProperties, ReactNode } from 'react';

export type IconName =
  | 'build'
  | 'assess'
  | 'handoff'
  | 'release'
  | 'knowledge'
  | 'sessions'
  | 'settings'
  | 'search'
  | 'plus'
  | 'play'
  | 'play-line'
  | 'stop'
  | 'pause'
  | 'check'
  | 'check-circle'
  | 'x'
  | 'x-circle'
  | 'alert'
  | 'info'
  | 'shield'
  | 'zap'
  | 'git'
  | 'github'
  | 'figma'
  | 'notion'
  | 'sentry'
  | 'chevron-r'
  | 'chevron-d'
  | 'chevron-l'
  | 'chevron-u'
  | 'more'
  | 'bell'
  | 'doc'
  | 'file-code'
  | 'folder'
  | 'terminal'
  | 'edit'
  | 'spark'
  | 'filter'
  | 'user'
  | 'bot'
  | 'send'
  | 'at'
  | 'slash'
  | 'paperclip'
  | 'lock'
  | 'eye'
  | 'refresh'
  | 'trend-up'
  | 'circle'
  | 'circle-half'
  | 'panel-r'
  | 'panel-l'
  | 'panel-b'
  | 'side-toggle'
  | 'tag'
  | 'command'
  | 'vil'
  | 'branch'
  | 'diff'
  | 'dot';

interface IconProps {
  name: IconName;
  size?: number;
  stroke?: number;
  style?: CSSProperties;
}

export function Icon({ name, size = 16, stroke = 1.6, style }: IconProps) {
  const s: CSSProperties = { width: size, height: size, ...(style ?? {}) };
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style: s,
  };
  switch (name) {
    case 'build':
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4.5 4.5 0 0 1 5.7 5.7l-1.4 1.4-5.7-5.7 1.4-1.4Z" />
          <path d="M3 21l8.5-8.5" />
          <path d="M14 6l4 4" />
        </svg>
      );
    case 'assess':
      return (
        <svg {...common}>
          <path d="M9 11l2 2 4-4" />
          <path d="M20 12a8 8 0 1 1-3-6.2" />
          <path d="M20 4v4h-4" />
        </svg>
      );
    case 'handoff':
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="M13 6l6 6-6 6" />
          <circle cx="5" cy="12" r="1.5" />
        </svg>
      );
    case 'release':
      return (
        <svg {...common}>
          <path d="M4.5 16.5L3 21l4.5-1.5" />
          <path d="M14 6l4 4" />
          <path d="M16 4l4 4-9.5 9.5L6 19l1.5-4.5L16 4Z" />
        </svg>
      );
    case 'knowledge':
      return (
        <svg {...common}>
          <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2V5Z" />
          <path d="M8 7h6" />
          <path d="M8 11h6" />
        </svg>
      );
    case 'sessions':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'play':
      return (
        <svg {...common}>
          <polygon points="6,4 20,12 6,20" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'play-line':
      return (
        <svg {...common}>
          <polygon points="6,4 20,12 6,20" />
        </svg>
      );
    case 'stop':
      return (
        <svg {...common}>
          <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...common}>
          <rect x="6" y="5" width="4" height="14" />
          <rect x="14" y="5" width="4" height="14" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M5 12l5 5L20 7" />
        </svg>
      );
    case 'check-circle':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 3 3 5-6" />
        </svg>
      );
    case 'x':
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case 'x-circle':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m9 9 6 6M15 9l-6 6" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...common}>
          <path d="M12 3 2 20h20L12 3Z" />
          <path d="M12 10v4" />
          <circle cx="12" cy="17" r="0.6" fill="currentColor" />
        </svg>
      );
    case 'info':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01" />
          <path d="M11 12h1v5h1" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3Z" />
        </svg>
      );
    case 'zap':
      return (
        <svg {...common}>
          <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
        </svg>
      );
    case 'git':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.2" />
          <circle cx="18" cy="18" r="2.2" />
          <circle cx="6" cy="18" r="2.2" />
          <path d="M6 8.5v7" />
          <path d="M6 18h6.5a3.5 3.5 0 0 0 3.5-3.5V8" />
        </svg>
      );
    case 'github':
      return (
        <svg {...common}>
          <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5a3 3 0 0 0-.9-2.3c3-.3 6-1.5 6-6.5a5 5 0 0 0-1.4-3.5 4.5 4.5 0 0 0-.1-3.5s-1.1-.3-3.6 1.4a12.4 12.4 0 0 0-6.6 0C6.5 1.4 5.4 1.7 5.4 1.7a4.5 4.5 0 0 0-.1 3.5A5 5 0 0 0 4 8.7c0 5 3 6.2 6 6.5a3 3 0 0 0-.9 2.3V21" />
        </svg>
      );
    case 'figma':
      return (
        <svg {...common}>
          <path d="M9 3h3v6H9a3 3 0 0 1 0-6Z" />
          <path d="M12 3h3a3 3 0 0 1 0 6h-3V3Z" />
          <path d="M12 9h3a3 3 0 0 1 0 6h-3V9Z" />
          <path d="M9 9h3v6H9a3 3 0 0 1 0-6Z" />
          <circle cx="10.5" cy="18" r="3" />
        </svg>
      );
    case 'notion':
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="M9 8v8" />
          <path d="M9 8l6 8" />
          <path d="M15 8v8" />
        </svg>
      );
    case 'sentry':
      return (
        <svg {...common}>
          <path d="M12 4 4 18h5a3 3 0 0 0 6 0h5L12 4Z" />
        </svg>
      );
    case 'chevron-r':
      return (
        <svg {...common}>
          <path d="m9 6 6 6-6 6" />
        </svg>
      );
    case 'chevron-d':
      return (
        <svg {...common}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      );
    case 'chevron-l':
      return (
        <svg {...common}>
          <path d="m15 6-6 6 6 6" />
        </svg>
      );
    case 'chevron-u':
      return (
        <svg {...common}>
          <path d="m6 15 6-6 6 6" />
        </svg>
      );
    case 'more':
      return (
        <svg {...common}>
          <circle cx="6" cy="12" r="1.2" fill="currentColor" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" />
          <circle cx="18" cy="12" r="1.2" fill="currentColor" />
        </svg>
      );
    case 'bell':
      return (
        <svg {...common}>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Z" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
      );
    case 'doc':
      return (
        <svg {...common}>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
          <path d="M14 3v6h6" />
        </svg>
      );
    case 'file-code':
      return (
        <svg {...common}>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
          <path d="M14 3v6h6" />
          <path d="m10 13-2 2 2 2" />
          <path d="m14 13 2 2-2 2" />
        </svg>
      );
    case 'folder':
      return (
        <svg {...common}>
          <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />
        </svg>
      );
    case 'terminal':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="m7 9 3 3-3 3" />
          <path d="M13 15h4" />
        </svg>
      );
    case 'edit':
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...common}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
        </svg>
      );
    case 'filter':
      return (
        <svg {...common}>
          <path d="M4 5h16l-6 8v6l-4-2v-4L4 5Z" />
        </svg>
      );
    case 'user':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
    case 'bot':
      return (
        <svg {...common}>
          <rect x="4" y="7" width="16" height="12" rx="3" />
          <circle cx="9" cy="13" r="1" fill="currentColor" />
          <circle cx="15" cy="13" r="1" fill="currentColor" />
          <path d="M12 7V3" />
          <path d="M10 3h4" />
        </svg>
      );
    case 'send':
      return (
        <svg {...common}>
          <path d="m4 11 16-7-7 16-2-7-7-2Z" />
        </svg>
      );
    case 'at':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M16 8v5a2 2 0 0 0 4 0v-1a8 8 0 1 0-3 6" />
        </svg>
      );
    case 'slash':
      return (
        <svg {...common}>
          <path d="M16 5 8 19" />
        </svg>
      );
    case 'paperclip':
      return (
        <svg {...common}>
          <path d="M21 11.5 12 20a5 5 0 0 1-7-7l9-9a3.5 3.5 0 1 1 5 5l-9 9a2 2 0 1 1-3-3l8-8" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...common}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 1 1 8 0v4" />
        </svg>
      );
    case 'eye':
      return (
        <svg {...common}>
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'refresh':
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
          <path d="M21 4v4h-4" />
          <path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" />
          <path d="M3 20v-4h4" />
        </svg>
      );
    case 'trend-up':
      return (
        <svg {...common}>
          <path d="m3 17 6-6 4 4 8-8" />
          <path d="M14 7h7v7" />
        </svg>
      );
    case 'circle':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case 'circle-half':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v18" stroke="currentColor" />
          <path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'panel-r':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M15 4v16" />
        </svg>
      );
    case 'panel-l':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </svg>
      );
    case 'panel-b':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 15h18" />
        </svg>
      );
    case 'side-toggle':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
          <path d="m13 9 3 3-3 3" />
        </svg>
      );
    case 'tag':
      return (
        <svg {...common}>
          <path d="m20 12-8 8-8-8V4h8l8 8Z" />
          <circle cx="9" cy="9" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'command':
      return (
        <svg {...common}>
          <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z" />
        </svg>
      );
    case 'vil':
      return (
        <svg {...common}>
          <path d="M3 5h6l3 7 3-7h6l-7 14h-4L3 5Z" />
        </svg>
      );
    case 'branch':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="6" cy="18" r="2" />
          <circle cx="18" cy="9" r="2" />
          <path d="M6 8v8" />
          <path d="M18 11a4 4 0 0 1-4 4H8" />
        </svg>
      );
    case 'diff':
      return (
        <svg {...common}>
          <path d="M12 3v18" />
          <path d="M9 6 6 9l3 3" />
          <path d="m15 18 3-3-3-3" />
        </svg>
      );
    case 'dot':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="6" />
        </svg>
      );
  }
}

interface AvatarProps {
  name?: string;
  color?: string | undefined;
}

export function Avatar({ name = 'AS', color }: AvatarProps) {
  const init = name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="topbar-avatar" style={color ? { background: color } : undefined}>
      {init}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd-key">{children}</span>;
}

export type SeverityLevel = 'crit' | 'high' | 'med' | 'low';
export type PlaneId = 'build' | 'assess' | 'handoff' | 'release' | 'knowledge';

export function Sev({ level = 'med' }: { level?: SeverityLevel }) {
  return <span className={`sev-dot ${level}`}></span>;
}

export function PlaneDot({ plane }: { plane: PlaneId }) {
  return <span className={`plane-dot ${plane}`}></span>;
}

export function SeverityBadge({ level }: { level: SeverityLevel }) {
  const map: Record<SeverityLevel, { c: string; l: string }> = {
    crit: { c: 'crit', l: 'Critical' },
    high: { c: 'warn', l: 'High' },
    med: { c: 'info', l: 'Medium' },
    low: { c: 'outline', l: 'Low' },
  };
  const m = map[level];
  return (
    <span className={`badge ${m.c}`}>
      <span className="dot" style={{ background: 'currentColor' }}></span>
      {m.l}
    </span>
  );
}
