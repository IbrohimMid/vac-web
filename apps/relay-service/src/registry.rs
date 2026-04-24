//! In-memory device + session registry. A "device" is a bridge that dialed
//! out; a "client" is a browser that attached to a session on that device.
//!
//! For v1 the registry is node-local. Horizontal fan-out (multi-relay) is
//! explicitly out of scope per the Phase 7 plan.

use dashmap::DashMap;
use tokio::sync::mpsc;

/// Single frame going through the relay. Payload is an opaque byte string —
/// the relay never inspects it. E2E mode wraps payload in ciphertext upstream
/// of the relay; plain mode sends bridge-authored JSON through as-is.
#[derive(Debug, Clone)]
pub struct Frame {
    pub session_id: String,
    pub seq: u64,
    pub payload: Vec<u8>,
    pub direction: Direction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    ToClient,
    ToBridge,
}

/// Each attached party (bridge or client) owns an outbound channel. The relay
/// writes frames it has routed; the party's task reads and forwards to its
/// WebSocket sink.
pub type FrameTx = mpsc::UnboundedSender<Frame>;

pub struct DeviceEntry {
    pub bridge: FrameTx,
    /// Sessions live on the bridge; clients subscribe per-session.
    pub clients: DashMap<String, Vec<FrameTx>>,
}

pub struct DeviceRegistry {
    devices: DashMap<String, DeviceEntry>,
}

impl DeviceRegistry {
    pub fn new() -> Self {
        Self {
            devices: DashMap::new(),
        }
    }

    pub fn register_bridge(&self, device_id: String, tx: FrameTx) {
        self.devices.insert(
            device_id,
            DeviceEntry {
                bridge: tx,
                clients: DashMap::new(),
            },
        );
    }

    pub fn unregister_bridge(&self, device_id: &str) {
        self.devices.remove(device_id);
    }

    pub fn attach_client(&self, device_id: &str, session_id: String, tx: FrameTx) -> bool {
        match self.devices.get(device_id) {
            Some(entry) => {
                entry
                    .clients
                    .entry(session_id)
                    .or_default()
                    .push(tx);
                true
            }
            None => false,
        }
    }

    pub fn detach_clients_for(&self, device_id: &str, session_id: &str) {
        if let Some(entry) = self.devices.get(device_id) {
            entry.clients.remove(session_id);
        }
    }

    /// Forward frame `ToBridge`. No-op if the device has no active bridge.
    pub fn forward_to_bridge(&self, device_id: &str, frame: Frame) -> bool {
        match self.devices.get(device_id) {
            Some(entry) => entry.bridge.send(frame).is_ok(),
            None => false,
        }
    }

    /// Fan-out frame `ToClient` to every attached client for this session.
    /// Returns the number of clients that actually accepted the frame
    /// (= post-retain length). Dropped senders are pruned.
    pub fn forward_to_clients(&self, device_id: &str, session_id: &str, frame: Frame) -> usize {
        let Some(entry) = self.devices.get(device_id) else {
            return 0;
        };
        let Some(mut list) = entry.clients.get_mut(session_id) else {
            return 0;
        };
        list.retain(|tx| tx.send(frame.clone()).is_ok());
        list.len()
    }

    /// Enumerate attached client txs for a device without mutating state.
    /// Callers use this to push a final "bridge went away" frame on tunnel
    /// loss before detach.
    pub fn all_client_txs_for_device(&self, device_id: &str) -> Vec<FrameTx> {
        let Some(entry) = self.devices.get(device_id) else {
            return vec![];
        };
        let mut out = Vec::new();
        for kv in entry.clients.iter() {
            for tx in kv.value() {
                out.push(tx.clone());
            }
        }
        out
    }
}

impl Default for DeviceRegistry {
    fn default() -> Self {
        Self::new()
    }
}
