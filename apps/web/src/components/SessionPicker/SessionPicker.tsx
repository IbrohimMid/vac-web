import { useState } from 'react';
import { useSession } from '../../stores/session';
import type { TransportHandle } from '../../transport';

/// Session-less commands (like session.create) are routed with a placeholder
/// session_id that bridge ignores; the real session_id arrives via
/// `session.ready` event. Constant makes the convention explicit.
const SESSION_CREATE_PLACEHOLDER = 'sess_pending_create';

interface ReadyPayload {
  session_id: string;
  profile_id?: string;
}

export function SessionPicker({ transport }: { transport: TransportHandle }) {
  const active = useSession((s) => s.sessionId);
  const [profile, setProfile] = useState('executor.code@1.0.0');
  const [projectRoot, setProjectRoot] = useState('/tmp/demo-project');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setCreating(true);
    setError(null);

    // Register listener BEFORE sending so we don't miss a fast session.ready.
    const off = transport.on('session.ready', (ev) => {
      const p = ev.payload as ReadyPayload | null;
      if (!p?.session_id) return;
      useSession.getState().setSession(p.session_id, profile, projectRoot);
      off();
    });

    try {
      const ack = await transport.send(SESSION_CREATE_PLACEHOLDER, 'session.create', {
        profile_id: profile,
        project_root: projectRoot,
      });
      if (!ack.ok) {
        off();
        setError(ack.error?.message ?? 'session.create failed');
      }
    } catch (e) {
      off();
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  if (active) {
    return (
      <div style={{ padding: 8, fontSize: 14, background: '#f7f7f7' }}>
        <strong>session:</strong> {active} · <em>{profile}</em>
      </div>
    );
  }

  return (
    <div style={{ padding: 12, border: '1px solid #ddd' }}>
      <h3>Start session</h3>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Profile:
        <select
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          style={{ marginLeft: 8 }}
        >
          <option value="executor.code@1.0.0">executor.code (build)</option>
          <option value="assessor.rtd@1.0.0">assessor.rtd (read-only)</option>
          <option value="assessor.pm@1.0.0">assessor.pm (read-only)</option>
        </select>
      </label>
      <label style={{ display: 'block', marginBottom: 8 }}>
        Project root:
        <input
          type="text"
          value={projectRoot}
          onChange={(e) => setProjectRoot(e.target.value)}
          style={{ marginLeft: 8, width: '60%' }}
        />
      </label>
      <button onClick={create} disabled={creating}>
        {creating ? 'creating…' : 'Create session'}
      </button>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </div>
  );
}
