// Token management: mint via /api/pair/mint, exchange via /api/pair/exchange.
// Stored in localStorage (bound to origin, acceptable for local bridge).

const ACCESS_KEY = 'vac_web_access_token';
const DEVICE_KEY = 'vac_web_device_id';

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function setAccessToken(token: string): void {
  localStorage.setItem(ACCESS_KEY, token);
}

export function clearAccessToken(): void {
  localStorage.removeItem(ACCESS_KEY);
}

export function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const fresh =
    'dev_' +
    Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  localStorage.setItem(DEVICE_KEY, fresh);
  return fresh;
}

export async function mintPairCode(): Promise<{ code: string; expires_in: number }> {
  const r = await fetch('/api/pair/mint', { method: 'POST' });
  if (!r.ok) throw new Error(`pair/mint failed: ${r.status}`);
  return r.json();
}

export async function exchangePairCode(
  code: string,
  projectRoot: string,
): Promise<{ access_token: string; expires_in: number }> {
  const deviceId = getOrCreateDeviceId();
  const r = await fetch('/api/pair/exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, device_id: deviceId, project_root: projectRoot }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`pair/exchange failed: ${r.status} ${body}`);
  }
  const data = await r.json();
  setAccessToken(data.access_token);
  return data;
}
