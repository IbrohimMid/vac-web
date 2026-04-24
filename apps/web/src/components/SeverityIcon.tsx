// Severity glyph + color per docs/ux-grammar.md §2.
// `✓ · ● ✗` used consistently across notify, topbar, approvals.

export type Severity = 'ok' | 'info' | 'warn' | 'error';

const GLYPH: Record<Severity, string> = {
  ok: '✓',
  info: '·',
  warn: '●',
  error: '✗',
};

const COLOR: Record<Severity, string> = {
  ok: 'var(--sev-ok)',
  info: 'var(--sev-info)',
  warn: 'var(--sev-warn)',
  error: 'var(--sev-error)',
};

export function SeverityIcon({ severity }: { severity: Severity }) {
  return (
    <span
      role="img"
      aria-label={severity}
      style={{
        color: COLOR[severity],
        fontWeight: 700,
        fontFamily: 'monospace',
        display: 'inline-block',
        width: 14,
        textAlign: 'center',
      }}
    >
      {GLYPH[severity]}
    </span>
  );
}
