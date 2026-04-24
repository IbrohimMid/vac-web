use bridge_core::{EventRing, ReplayResult};

#[test]
fn empty_ring_replays_up_to_date() {
    let r: EventRing<String> = EventRing::new(10);
    assert!(r.is_empty());
    assert_eq!(r.replay_after(0), ReplayResult::UpToDate);
    assert_eq!(r.oldest_seq(), None);
    assert_eq!(r.latest_seq(), None);
}

#[test]
fn push_assigns_monotonic_seqs() {
    let mut r: EventRing<&str> = EventRing::new(10);
    assert_eq!(r.push("a"), 1);
    assert_eq!(r.push("b"), 2);
    assert_eq!(r.push("c"), 3);
    assert_eq!(r.oldest_seq(), Some(1));
    assert_eq!(r.latest_seq(), Some(3));
}

#[test]
fn replay_after_returns_newer_events() {
    let mut r: EventRing<&str> = EventRing::new(10);
    r.push("a");
    r.push("b");
    r.push("c");
    let ReplayResult::Stream(events) = r.replay_after(1) else {
        panic!("expected Stream");
    };
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].0, 2);
}

#[test]
fn replay_at_latest_is_up_to_date() {
    let mut r: EventRing<&str> = EventRing::new(10);
    r.push("a");
    r.push("b");
    assert_eq!(r.replay_after(2), ReplayResult::UpToDate);
    assert_eq!(r.replay_after(100), ReplayResult::UpToDate);
}

#[test]
fn ring_drops_oldest_on_overflow() {
    let mut r: EventRing<u32> = EventRing::new(3);
    for i in 0..5 {
        r.push(i);
    }
    // Oldest should now be seq 3 (items with seq 1, 2 evicted).
    assert_eq!(r.oldest_seq(), Some(3));
    assert_eq!(r.latest_seq(), Some(5));
}

#[test]
fn replay_before_oldest_is_out_of_range() {
    let mut r: EventRing<u32> = EventRing::new(3);
    for i in 0..5 {
        r.push(i);
    }
    match r.replay_after(0) {
        ReplayResult::OutOfRange { oldest, requested } => {
            assert_eq!(oldest, 3);
            assert_eq!(requested, 0);
        }
        other => panic!("expected OutOfRange, got {other:?}"),
    }
}

#[test]
fn replay_at_oldest_minus_one_is_stream() {
    // If client has seq=2 and oldest is 3, we can replay [3, 4, 5].
    let mut r: EventRing<u32> = EventRing::new(3);
    for i in 0..5 {
        r.push(i);
    }
    let ReplayResult::Stream(events) = r.replay_after(2) else {
        panic!("expected Stream");
    };
    assert_eq!(events.len(), 3);
    assert_eq!(events.first().unwrap().0, 3);
}

#[test]
fn ring_len_tracks_cap() {
    let mut r: EventRing<u8> = EventRing::new(2);
    r.push(0);
    r.push(0);
    r.push(0);
    assert_eq!(r.len(), 2);
}
