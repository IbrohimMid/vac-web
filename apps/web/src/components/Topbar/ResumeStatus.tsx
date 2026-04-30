// Compact resume-status indicator for the topbar. Stage X6 4-5
// extends the original Phase-3 chip with the new progress states
// (`initializing`, `loading_native`, `replaying { replayed }`) and
// surfaces both the *effective* terminal mode (native vs replay vs
// fallback) and the failure reason. The chip stays sticky after a
// terminal state so the operator has a chance to read it.

import { useSessionHistory } from '../../stores/sessionHistory';

export function ResumeStatus() {
  const resume = useSessionHistory((s) => s.resume);

  if (resume.kind === 'idle') return null;

  if (resume.kind === 'starting') {
    return (
      <span aria-live="polite" style={chip('blue')}>
        Resuming {short(resume.vac_session_id)}… ({resume.mode})
      </span>
    );
  }

  if (resume.kind === 'initializing') {
    return (
      <span aria-live="polite" style={chip('blue')}>
        Initializing {short(resume.vac_session_id)}…
      </span>
    );
  }

  if (resume.kind === 'loading_native') {
    return (
      <span aria-live="polite" style={chip('blue')}>
        Loading {short(resume.vac_session_id)} natively…
      </span>
    );
  }

  if (resume.kind === 'replaying') {
    return (
      <span aria-live="polite" style={chip('blue')}>
        Replaying {short(resume.vac_session_id)}…
        {resume.replayed > 0 ? ` (${resume.replayed} events)` : ''}
      </span>
    );
  }

  if (resume.kind === 'resumed') {
    const tone = resume.mode === 'replay_only_fallback' ? 'amber' : 'green';
    const label =
      resume.mode === 'native'
        ? 'native'
        : resume.mode === 'replay_only_fallback'
          ? 'replay (fallback)'
          : 'replay';
    return (
      <span aria-live="polite" style={chip(tone)}>
        Resumed {short(resume.vac_session_id)} · {resume.replayed} events ({label})
      </span>
    );
  }

  return (
    <span
      aria-live="assertive"
      style={chip('red')}
      title={resume.detail ? `${resume.reason}: ${resume.detail}` : resume.reason}
    >
      Resume failed: {short(resume.vac_session_id)} — {resume.reason}
    </span>
  );
}

function short(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function chip(tone: 'blue' | 'green' | 'red' | 'amber'): React.CSSProperties {
  const colors: Record<'blue' | 'green' | 'red' | 'amber', { bg: string; fg: string }> = {
    blue: { bg: '#1d4ed833', fg: '#bfdbfe' },
    green: { bg: '#15803d33', fg: '#bbf7d0' },
    red: { bg: '#b9111133', fg: '#fecaca' },
    amber: { bg: '#b4530933', fg: '#fed7aa' },
  };
  const c = colors[tone];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 8px',
    borderRadius: 999,
    background: c.bg,
    color: c.fg,
    fontSize: 12,
    fontWeight: 500,
  };
}
