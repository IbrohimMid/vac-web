use bridge_core::{BridgeError, ResourceLimits, ResourceUsage};
use std::time::Duration;

#[test]
fn tool_call_limit_enforced() {
    let usage = ResourceUsage::new(ResourceLimits {
        max_tool_calls: Some(3),
        ..Default::default()
    });
    for i in 1..=3 {
        assert_eq!(usage.increment_tool_calls().unwrap(), i);
    }
    let err = usage.increment_tool_calls().unwrap_err();
    assert!(matches!(err, BridgeError::ResourceExhausted { .. }));
    assert_eq!(err.code(), "resource.exhausted");
    // After rollback, snapshot should still be 3.
    assert_eq!(usage.snapshot().tool_calls, 3);
}

#[test]
fn no_limit_allows_growth() {
    let usage = ResourceUsage::new(ResourceLimits::default());
    for _ in 0..1000 {
        usage.increment_tool_calls().unwrap();
    }
    assert_eq!(usage.snapshot().tool_calls, 1000);
}

#[test]
fn child_guard_roundtrip() {
    let usage = ResourceUsage::new(ResourceLimits {
        max_concurrent_children: Some(2),
        ..Default::default()
    });
    let g1 = usage.acquire_child().unwrap();
    let g2 = usage.acquire_child().unwrap();
    assert_eq!(usage.snapshot().concurrent_children, 2);
    let err = usage.acquire_child().unwrap_err();
    assert!(matches!(err, BridgeError::ResourceExhausted { .. }));
    drop(g1);
    drop(g2);
    assert_eq!(usage.snapshot().concurrent_children, 0);
    // Can acquire again
    let _g = usage.acquire_child().unwrap();
    assert_eq!(usage.snapshot().concurrent_children, 1);
}

#[test]
fn wallclock_limit_trips() {
    let usage = ResourceUsage::new(ResourceLimits {
        max_wallclock: Some(Duration::from_millis(50)),
        ..Default::default()
    });
    std::thread::sleep(Duration::from_millis(60));
    let err = usage.check_wallclock().unwrap_err();
    assert!(matches!(err, BridgeError::ResourceExhausted { .. }));
}

#[test]
fn wallclock_ok_when_no_limit() {
    let usage = ResourceUsage::new(ResourceLimits::default());
    usage.check_wallclock().unwrap();
}
