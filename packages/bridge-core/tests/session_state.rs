use bridge_core::{allowed_transition, BridgeError, SessionState, StateHolder};

#[test]
fn legal_transitions_pass() {
    use SessionState::*;
    for (from, to) in [
        (Spawning, Ready),
        (Spawning, Closing),
        (Spawning, Closed),
        (Ready, Active),
        (Ready, Idle),
        (Ready, Closing),
        (Active, Idle),
        (Active, Closing),
        (Idle, Active),
        (Idle, Closing),
        (Closing, Closed),
    ] {
        assert!(
            allowed_transition(from, to),
            "{from:?} -> {to:?} should be allowed"
        );
    }
}

#[test]
fn illegal_transitions_fail() {
    use SessionState::*;
    for (from, to) in [
        (Closed, Ready),
        (Closed, Active),
        (Active, Spawning),
        (Ready, Closed),    // must pass through Closing
        (Spawning, Active), // must pass through Ready
        (Closing, Active),
    ] {
        assert!(
            !allowed_transition(from, to),
            "{from:?} -> {to:?} must not be allowed"
        );
    }
}

#[test]
fn state_holder_transitions() {
    let h = StateHolder::new();
    assert_eq!(h.current(), SessionState::Spawning);
    h.transition(SessionState::Ready).unwrap();
    assert_eq!(h.current(), SessionState::Ready);
    h.transition(SessionState::Active).unwrap();
    assert_eq!(h.current(), SessionState::Active);
}

#[test]
fn illegal_transition_returns_err() {
    let h = StateHolder::new();
    h.transition(SessionState::Ready).unwrap();
    h.transition(SessionState::Active).unwrap();
    let err = h.transition(SessionState::Spawning).unwrap_err();
    assert!(matches!(err, BridgeError::InvalidTransition { .. }));
}

#[test]
fn idempotent_self_transition_ok() {
    let h = StateHolder::new();
    h.transition(SessionState::Spawning).unwrap();
    assert_eq!(h.current(), SessionState::Spawning);
}

#[test]
fn is_terminal_and_is_open() {
    assert!(SessionState::Closed.is_terminal());
    assert!(!SessionState::Closed.is_open());
    assert!(SessionState::Active.is_open());
    assert!(!SessionState::Active.is_terminal());
}
