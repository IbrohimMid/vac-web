//! Pairing code mint + one-time consume. TTL 60s.
//!
//! Codes are generated from OS CSPRNG (`rand::thread_rng()`) not wallclock — the
//! earlier implementation used `SystemTime::now` which allowed a local attacker
//! to guess codes within ~100 tries given approximate pairing time.

use dashmap::DashMap;
use rand::Rng;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Upper cap per 60s window to mitigate brute-force across multiple mints.
const MAX_ACTIVE_CODES: usize = 16;

#[derive(Clone)]
pub struct PairingStore {
    inner: Arc<DashMap<String, Instant>>,
    ttl: Duration,
}

impl PairingStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(DashMap::new()),
            ttl: Duration::from_secs(60),
        }
    }

    /// Mint a random 8-digit code. Uses OS CSPRNG.
    /// Returns `None` if too many codes are currently active (rate-limit).
    pub fn mint(&self) -> Option<String> {
        self.purge();
        if self.inner.len() >= MAX_ACTIVE_CODES {
            return None;
        }
        let mut rng = rand::thread_rng();
        // Retry until we find a slot not taken (practically first try).
        for _ in 0..5 {
            let n: u32 = rng.gen_range(0..100_000_000);
            let code = format!("{n:08}");
            if self.inner.insert(code.clone(), Instant::now()).is_none() {
                return Some(code);
            }
        }
        None
    }

    pub fn consume(&self, code: &str) -> bool {
        self.purge();
        self.inner.remove(code).is_some()
    }

    fn purge(&self) {
        let ttl = self.ttl;
        self.inner.retain(|_, ts| ts.elapsed() < ttl);
    }

    pub fn active_count(&self) -> usize {
        self.inner.len()
    }
}

impl Default for PairingStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mint_then_consume() {
        let s = PairingStore::new();
        let c = s.mint().unwrap();
        assert_eq!(c.len(), 8);
        assert!(s.consume(&c));
    }

    #[test]
    fn cannot_consume_twice() {
        let s = PairingStore::new();
        let c = s.mint().unwrap();
        assert!(s.consume(&c));
        assert!(!s.consume(&c));
    }

    #[test]
    fn unknown_code_rejected() {
        let s = PairingStore::new();
        assert!(!s.consume("99999999"));
    }

    #[test]
    fn codes_are_distinct_across_consecutive_mints() {
        let s = PairingStore::new();
        let a = s.mint().unwrap();
        let b = s.mint().unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn rate_limit_caps_active_codes() {
        let s = PairingStore::new();
        for _ in 0..MAX_ACTIVE_CODES {
            assert!(s.mint().is_some());
        }
        assert!(s.mint().is_none(), "should hit cap");
        assert_eq!(s.active_count(), MAX_ACTIVE_CODES);
    }
}
