// Sidebar — primary nav. 6 planes (Build/Assess/Handoff/Release/Knowledge/
// Sessions) + recent sessions list. Counts/pills are derived from real
// stores so badges reflect live state, not fixtures.

import { useApprovals } from '../../stores/approvals';
import { useAssessment } from '../../stores/assessment';
import { useCockpit, type Route } from '../../stores/cockpit';
import { useHandoff } from '../../stores/handoff';
import { useSessions } from '../../stores/sessions';
import { Icon, type IconName } from './primitives';

interface PlaneNav {
  id: Route;
  label: string;
  icon: IconName;
}

const PLANES: PlaneNav[] = [
  { id: 'build', label: 'Build', icon: 'build' },
  { id: 'assess', label: 'Assess', icon: 'assess' },
  { id: 'handoff', label: 'Handoff', icon: 'handoff' },
  { id: 'release', label: 'Release', icon: 'release' },
  { id: 'knowledge', label: 'Knowledge', icon: 'knowledge' },
  { id: 'sessions', label: 'Sessions', icon: 'sessions' },
];

export function Sidebar() {
  const route = useCockpit((s) => s.route);
  const setRoute = useCockpit((s) => s.setRoute);
  const sidebarCollapsed = useCockpit((s) => s.sidebarCollapsed);

  const pendingApprovals = useApprovals((s) => s.pendingOrder.length);
  const runningRuns = useAssessment((s) => {
    let n = 0;
    for (const r of s.runs.values()) if (r.status === 'running') n++;
    return n;
  });
  const pendingPackets = useHandoff((s) => {
    let n = 0;
    for (const p of s.packets.values())
      if (
        p.status === 'pending_approval' ||
        p.status === 'dispatched' ||
        p.status === 'executing'
      )
        n++;
    return n;
  });
  const sessions = useSessions((s) => s.rows);

  const countFor = (id: Route): number | null => {
    if (id === 'build') return pendingApprovals || null;
    if (id === 'assess') return runningRuns || null;
    if (id === 'handoff') return pendingPackets || null;
    return null;
  };

  return (
    <aside className="sidebar">
      <div className="side-section">Workspace</div>
      {PLANES.map((p) => {
        const c = countFor(p.id);
        return (
          <div
            key={p.id}
            className={`side-item ${route === p.id ? 'active' : ''}`}
            onClick={() => setRoute(p.id)}
            role="link"
            aria-current={route === p.id ? 'page' : undefined}
          >
            <Icon name={p.icon} size={16} />
            {!sidebarCollapsed && <span>{p.label}</span>}
            {!sidebarCollapsed && c != null && <span className="count">{c}</span>}
          </div>
        );
      })}

      {!sidebarCollapsed && sessions.length > 0 && (
        <>
          <div className="side-section" style={{ marginTop: 12 }}>
            Recent
          </div>
          {sessions.slice(0, 4).map((s) => (
            <div
              key={s.id}
              className="side-item"
              style={{ height: 28, fontSize: 12.5 }}
              role="link"
              onClick={() => setRoute('sessions')}
            >
              <Icon
                name="dot"
                size={10}
                style={{ color: s.status === 'active' ? 'var(--ok)' : 'var(--ink-5)' }}
              />
              <span
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {s.id.slice(0, 16)}
              </span>
            </div>
          ))}
        </>
      )}

      <div className="side-foot">
        <span className="dot"></span>
        {!sidebarCollapsed && <span>Local engine · idle</span>}
      </div>
    </aside>
  );
}
