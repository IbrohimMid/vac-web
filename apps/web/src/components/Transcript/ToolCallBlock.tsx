// Inline tool-call block — Stage H.
// Renders below the message body when `Message.toolCall` is set. Header is
// always visible (name + args + status); body is collapsible. Visual chrome
// uses cockpit `.tool-call` classes shipped in apps/web/src/styles/cockpit.css.

import { useState } from 'react';
import type { ToolCall } from '../../stores/transcript';
import { affordanceFor } from '../../domain/capabilities/affordanceCatalog';
import { Icon } from '../cockpit/primitives';

// Slice 33: tool-call expand/collapse routes through the affordance
// catalog so the wiring is auditable. The toggle is `frontend_owned`
// and resolved once at module load (the decision is static).
const TOGGLE_AFFORDANCE = affordanceFor('transcript.tool.toggle', {
  commandStatus: 'frontend_owned',
  hasTransport: false,
  hasSessionId: false,
});

const STATUS_BADGE: Record<ToolCall['status'], { className: string; label: string }> = {
  ok: { className: 'badge ok', label: 'ok' },
  pending: { className: 'badge accent', label: 'pending' },
  error: { className: 'badge crit', label: 'error' },
};

interface Props {
  tc: ToolCall;
  /** Default-collapsed for cold messages; expanded for hot/streaming. */
  defaultOpen?: boolean;
}

export function ToolCallBlock({ tc, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const badge = STATUS_BADGE[tc.status];
  return (
    <div className="tool-call">
      <div
        className="tool-call-hd"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        data-affordance-id={TOGGLE_AFFORDANCE.affordanceId}
        aria-disabled={!TOGGLE_AFFORDANCE.enabled}
        title={TOGGLE_AFFORDANCE.disabledReason ?? undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <span className="tool-icon">
          <Icon name="zap" size={12} />
        </span>
        <span className="name">{tc.name}</span>
        <span className="args">{tc.args}</span>
        <span className="status">
          <span className={badge.className}>
            <Icon
              name={tc.status === 'ok' ? 'check' : tc.status === 'error' ? 'x' : 'play-line'}
              size={10}
            />
            {badge.label}
          </span>
        </span>
        <Icon
          name={open ? 'chevron-d' : 'chevron-r'}
          size={13}
          style={{ color: 'var(--ink-4)' }}
        />
      </div>
      {open && tc.output && <div className="tool-call-body">{tc.output}</div>}
    </div>
  );
}
