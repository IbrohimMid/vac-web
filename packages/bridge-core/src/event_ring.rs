//! Bounded ring buffer for per-session event replay.

use std::collections::VecDeque;

pub struct EventRing<T: Clone> {
    buf: VecDeque<(u64, T)>,
    cap: usize,
    next_seq: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplayResult<T> {
    /// Stream of `(seq, event)` tuples with seq > requested.
    Stream(Vec<(u64, T)>),
    /// Requested cursor older than oldest retained — client must resync from snapshot.
    OutOfRange { oldest: u64, requested: u64 },
    /// Requested cursor at or past latest — nothing to replay.
    UpToDate,
}

impl<T: Clone> EventRing<T> {
    pub fn new(cap: usize) -> Self {
        assert!(cap > 0, "EventRing cap must be > 0");
        Self {
            buf: VecDeque::with_capacity(cap),
            cap,
            next_seq: 1,
        }
    }

    /// Push an event; returns assigned seq (monotonic, starting at 1).
    pub fn push(&mut self, ev: T) -> u64 {
        let seq = self.next_seq;
        self.next_seq += 1;
        if self.buf.len() == self.cap {
            self.buf.pop_front();
        }
        self.buf.push_back((seq, ev));
        seq
    }

    /// Return events with seq > `last_event_id`, or signal out-of-range / up-to-date.
    pub fn replay_after(&self, last_event_id: u64) -> ReplayResult<T> {
        let Some(latest) = self.latest_seq() else {
            return ReplayResult::UpToDate;
        };
        if last_event_id >= latest {
            return ReplayResult::UpToDate;
        }
        let Some(oldest) = self.oldest_seq() else {
            return ReplayResult::UpToDate;
        };
        if last_event_id + 1 < oldest {
            return ReplayResult::OutOfRange {
                oldest,
                requested: last_event_id,
            };
        }
        let stream: Vec<(u64, T)> = self
            .buf
            .iter()
            .filter(|(s, _)| *s > last_event_id)
            .cloned()
            .collect();
        ReplayResult::Stream(stream)
    }

    pub fn oldest_seq(&self) -> Option<u64> {
        self.buf.front().map(|(s, _)| *s)
    }

    pub fn latest_seq(&self) -> Option<u64> {
        self.buf.back().map(|(s, _)| *s)
    }

    pub fn len(&self) -> usize {
        self.buf.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    pub fn cap(&self) -> usize {
        self.cap
    }

    pub fn next_seq(&self) -> u64 {
        self.next_seq
    }
}
