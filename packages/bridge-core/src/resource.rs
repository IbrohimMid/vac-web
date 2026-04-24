//! Per-session resource counters with hard limits.

use crate::error::{BridgeError, Result};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, Default)]
pub struct ResourceLimits {
    pub max_tool_calls: Option<u64>,
    pub max_wallclock: Option<Duration>,
    pub max_concurrent_children: Option<u32>,
}

#[derive(Debug, Clone, Copy)]
pub struct ResourceSnapshot {
    pub tool_calls: u64,
    pub elapsed: Duration,
    pub concurrent_children: u32,
}

pub struct ResourceUsage {
    tool_calls: AtomicU64,
    started_at: Instant,
    children: AtomicU32,
    limits: ResourceLimits,
}

impl ResourceUsage {
    pub fn new(limits: ResourceLimits) -> Arc<Self> {
        Arc::new(Self {
            tool_calls: AtomicU64::new(0),
            started_at: Instant::now(),
            children: AtomicU32::new(0),
            limits,
        })
    }

    pub fn limits(&self) -> ResourceLimits {
        self.limits
    }

    pub fn increment_tool_calls(&self) -> Result<u64> {
        let next = self.tool_calls.fetch_add(1, Ordering::AcqRel) + 1;
        if let Some(limit) = self.limits.max_tool_calls {
            if next > limit {
                // Roll back so subsequent snapshot reflects the limit.
                self.tool_calls.fetch_sub(1, Ordering::AcqRel);
                return Err(BridgeError::ResourceExhausted {
                    what: "max_tool_calls",
                });
            }
        }
        Ok(next)
    }

    pub fn acquire_child(self: &Arc<Self>) -> Result<ChildGuard> {
        let next = self.children.fetch_add(1, Ordering::AcqRel) + 1;
        if let Some(limit) = self.limits.max_concurrent_children {
            if next > limit {
                self.children.fetch_sub(1, Ordering::AcqRel);
                return Err(BridgeError::ResourceExhausted {
                    what: "max_concurrent_children",
                });
            }
        }
        Ok(ChildGuard {
            inner: Arc::clone(self),
        })
    }

    pub fn check_wallclock(&self) -> Result<()> {
        if let Some(limit) = self.limits.max_wallclock {
            if self.started_at.elapsed() > limit {
                return Err(BridgeError::ResourceExhausted {
                    what: "max_wallclock",
                });
            }
        }
        Ok(())
    }

    pub fn snapshot(&self) -> ResourceSnapshot {
        ResourceSnapshot {
            tool_calls: self.tool_calls.load(Ordering::Acquire),
            elapsed: self.started_at.elapsed(),
            concurrent_children: self.children.load(Ordering::Acquire),
        }
    }
}

/// RAII child-count token. Drops decrement `children` counter.
pub struct ChildGuard {
    inner: Arc<ResourceUsage>,
}

impl std::fmt::Debug for ChildGuard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChildGuard").finish_non_exhaustive()
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        self.inner.children.fetch_sub(1, Ordering::AcqRel);
    }
}
