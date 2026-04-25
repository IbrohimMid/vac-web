// SurfacePage — cockpit page chrome (Stage D).
// Wraps Assess / Handoff / Release / Knowledge / Sessions surfaces with the
// prototype's `.page` + `.page-narrow` + `.page-hd` layout. The `actions` slot
// receives the surface-specific controls (Run sweep, Refresh, etc.).

import type { ReactNode } from 'react';
import { Icon, type IconName } from './primitives';

interface Props {
  title: string;
  subtitle?: string;
  icon?: IconName;
  actions?: ReactNode;
  children: ReactNode;
  /** Drop the centered narrow column for full-bleed surfaces (e.g. Sessions). */
  fullBleed?: boolean;
}

export function SurfacePage({ title, subtitle, icon, actions, children, fullBleed }: Props) {
  const inner = (
    <>
      <div className="page-hd">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {icon && <Icon name={icon} size={20} style={{ color: 'var(--accent-2)' }} />}
            {title}
          </h1>
          {subtitle && <div className="sub">{subtitle}</div>}
        </div>
        {actions && <div className="right">{actions}</div>}
      </div>
      {children}
    </>
  );
  return (
    <div className="page">
      {fullBleed ? inner : <div className="page-narrow">{inner}</div>}
    </div>
  );
}
