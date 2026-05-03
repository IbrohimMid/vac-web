import { afterEach, describe, expect, it } from 'vitest';
import { useTranscript } from '../stores/transcript';
import { applyLifecycleEvent } from './modeWiring';

afterEach(() => {
	useTranscript.getState().setMode('live');
});

describe('modeWiring.applyLifecycleEvent', () => {
	it('session.replay.started moves live -> replay', () => {
		useTranscript.getState().setMode('live');
		expect(applyLifecycleEvent('session.replay.started')).toBe('replay');
		expect(useTranscript.getState().mode).toBe('replay');
	});

	it('session.replay.finished moves replay -> frozen', () => {
		useTranscript.getState().setMode('replay');
		expect(applyLifecycleEvent('session.replay.finished')).toBe('frozen');
		expect(useTranscript.getState().mode).toBe('frozen');
	});

	it('session.archived moves any mode -> frozen', () => {
		useTranscript.getState().setMode('live');
		expect(applyLifecycleEvent('session.archived')).toBe('frozen');
		expect(useTranscript.getState().mode).toBe('frozen');
	});

	it('session.closed moves any mode -> frozen', () => {
		useTranscript.getState().setMode('replay');
		expect(applyLifecycleEvent('session.closed')).toBe('frozen');
		expect(useTranscript.getState().mode).toBe('frozen');
	});

	it('session.opened resets to live', () => {
		useTranscript.getState().setMode('frozen');
		expect(applyLifecycleEvent('session.opened')).toBe('live');
		expect(useTranscript.getState().mode).toBe('live');
	});

	it('no-op when next mode equals current', () => {
		useTranscript.getState().setMode('live');
		expect(applyLifecycleEvent('session.opened')).toBe('live');
		expect(useTranscript.getState().mode).toBe('live');
	});
});
