import { useEffect, useState } from 'react';
import { exchangePairCode, getAccessToken, mintPairCode } from '../transport/auth';

const DEFAULT_PROJECT_ROOT =
  import.meta.env.VITE_VAC_WEB_DEFAULT_PROJECT_ROOT ?? '/tmp/demo-project';

export function PairingPrompt({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<string>('');
  const [projectRoot, setProjectRoot] = useState(DEFAULT_PROJECT_ROOT);
  const paired = !!getAccessToken();

  useEffect(() => {
    if (paired) onPaired();
  }, [paired, onPaired]);

  if (paired) {
    return null;
  }

  const mint = async () => {
    try {
      const m = await mintPairCode();
      setCode(m.code);
      setStatus(`Code minted: ${m.code} (valid ${m.expires_in}s)`);
    } catch (e) {
      setStatus(`mint failed: ${e}`);
    }
  };

  const exchange = async () => {
    try {
      await exchangePairCode(code, projectRoot);
      setStatus('paired ✓');
      onPaired();
    } catch (e) {
      setStatus(`exchange failed: ${e}`);
    }
  };

  return (
    <section style={{ padding: 24 }}>
      <h2>Pair with bridge</h2>
      <p>
        Two options: mint a code in-browser (dev), or paste a code printed by the CLI (real
        pairing flow from Phase 1.4).
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <button onClick={mint}>Mint code (dev)</button>
        <span>or</span>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="8-digit code"
          maxLength={8}
          style={{ width: 120, padding: 6 }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label>
          Project root for this device:
          <input
            type="text"
            value={projectRoot}
            onChange={(e) => setProjectRoot(e.target.value)}
            style={{ marginLeft: 8, width: '60%', padding: 6 }}
          />
        </label>
      </div>
      <button onClick={exchange} disabled={!code}>
        Exchange code for access
      </button>
      {status && <p>{status}</p>}
    </section>
  );
}
