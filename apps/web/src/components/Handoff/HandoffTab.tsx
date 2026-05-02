// Handoff tab: left rail lists packets, right pane shows selected packet
// (HandoffBuilder when none selected or when "New" clicked).

import { useState } from 'react';
import { HandoffBuilder } from './HandoffBuilder';
import { PacketDetail } from './PacketDetail';
import { useHandoff } from '../../stores/handoff';
import type { TransportHandle } from '../../transport';

interface Props {
  transport: TransportHandle | null;
}

export function HandoffTab({ transport }: Props) {
  const order = useHandoff((s) => s.order);
  const packets = useHandoff((s) => s.packets);
  const activeId = useHandoff((s) => s.activePacketId);
  const setActive = useHandoff((s) => s.setActive);
  const [composing, setComposing] = useState(order.length === 0);

  const active = activeId ? packets.get(activeId) : null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 8 }}>
      <aside
        aria-label="Packet list"
        style={{ borderRight: '1px solid var(--line)', paddingRight: 6 }}
      >
        <button
          onClick={() => {
            setComposing(true);
            setActive(null);
          }}
          style={{ width: '100%', marginBottom: 6 }}
        >
          + New packet
        </button>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {order.length === 0 && (
            <li style={{ color: 'var(--text-2)', fontSize: 12 }}>No packets yet.</li>
          )}
          {order.map((id) => {
            const p = packets.get(id);
            if (!p) return null;
            const selected = id === activeId && !composing;
            return (
              <li
                key={id}
                onClick={() => {
                  setComposing(false);
                  setActive(id);
                }}
                style={{
                  padding: 6,
                  borderRadius: 4,
                  cursor: 'pointer',
                  background: selected ? 'var(--bg-2, #222)' : 'transparent',
                }}
              >
                <div style={{ fontSize: 13 }}>{p.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-2)' }}>{p.status}</div>
              </li>
            );
          })}
        </ul>
      </aside>
      <section>
        {composing || !active ? (
          <HandoffBuilder transport={transport} />
        ) : (
          <PacketDetail packet={active} transport={transport} />
        )}
      </section>
    </div>
  );
}
