// Stage X.5d — cockpit reauth affordance.
//
// Renders one button per advertised ACP auth method. Clicking sends the
// bridge-owned `session.authenticate` command; the bridge owns the gate
// (advertised methods, terminal HOLD, env_var recreate path) and emits
// `session.auth_requested` / `session.auth_updated` / `session.auth_failed`
// which the session store mirrors. This component reads the store, it
// does NOT speak to the adapter directly — control plane stays
// bridge-authoritative.
//
// Lives in `cockpit/` rather than `Topbar/` because the same component
// is consumed from the SessionPicker active-session banner; future
// surfaces (Rail Memory, etc.) can drop it in once they have transport
// access.

import { useSession, type AcpAuthError, type AcpAuthStatus } from '../../stores/session';
import { authMethodTypeLabel, type AcpAuthMethod } from '../../domain/sessions/auth';
import type { TransportHandle } from '../../transport';

export interface ReauthActionProps {
  transport: TransportHandle;
  /// Optional override; defaults to the active session id from the store.
  sessionId?: string | null;
}

function statusLabel(
  status: AcpAuthStatus,
  lastMethodId: string | null,
  error: AcpAuthError | null,
): string | null {
  if (status === 'requesting') {
    return lastMethodId ? `signing in via ${lastMethodId}…` : 'signing in…';
  }
  if (status === 'authenticated') {
    return lastMethodId ? `signed in via ${lastMethodId}` : 'signed in';
  }
  if (status === 'failed' && error) {
    return `${error.code}: ${error.message}`;
  }
  return null;
}

export function ReauthAction({ transport, sessionId }: ReauthActionProps) {
  const activeSessionId = useSession((s) => s.sessionId);
  const agentKind = useSession((s) => s.agentKind);
  const authMethods = useSession((s) => s.authMethods);
  const authStatus = useSession((s) => s.authStatus);
  const authError = useSession((s) => s.authError);
  const lastAuthMethodId = useSession((s) => s.lastAuthMethodId);

  const sid = sessionId ?? activeSessionId;

  // Reauth is ACP-only; bail out cheaply when the session isn't ACP or
  // the adapter advertised no methods.
  if (agentKind !== 'acp' || authMethods.length === 0 || !sid) {
    return null;
  }

  const onClick = (method: AcpAuthMethod) => {
    // Optimistic: flip to 'requesting' so the button reflects the
    // user's intent immediately. The bridge will confirm via
    // `session.auth_requested` (no-op visual), then either
    // `session.auth_updated` or `session.auth_failed`.
    useSession.getState().setAuthStatus('requesting');
    useSession.getState().setAuthError(null);
    useSession.getState().setLastAuthMethodId(method.id);
    void transport
      .send(sid, 'session.authenticate', { auth_method_id: method.id })
      .catch((e) => {
        // Network / transport failure before the bridge could ack.
        useSession.getState().setAuthStatus('failed');
        useSession.getState().setAuthError({
          code: 'auth.transport_error',
          message: String(e),
          authMethodId: method.id,
        });
      });
  };

  const status = statusLabel(authStatus, lastAuthMethodId, authError);

  return (
    <span
      role="group"
      aria-label="ACP reauth"
      data-testid="reauth-action"
      style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}
    >
      {authMethods.map((method) => {
        const busy = authStatus === 'requesting' && lastAuthMethodId === method.id;
        return (
          <button
            key={method.id}
            type="button"
            disabled={authStatus === 'requesting'}
            onClick={() => onClick(method)}
            title={method.description ?? `${method.name} (${authMethodTypeLabel(method)})`}
            data-method-id={method.id}
            data-method-type={method.type}
          >
            {busy ? `${method.name}…` : `Reauth: ${method.name}`}
          </button>
        );
      })}
      {status && (
        <span
          role="status"
          data-testid="reauth-status"
          data-auth-status={authStatus}
          style={{ fontSize: 12, opacity: 0.85 }}
        >
          {status}
        </span>
      )}
    </span>
  );
}
