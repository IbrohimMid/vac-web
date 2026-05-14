/**
 * In-process WebSocket mock bridge for the sweep-cockpit Playwright suite.
 *
 * Speaks the subset of the bridge protocol the assessment hub uses:
 *   - handshake (welcome)
 *   - session/new (returns a fixed session_id)
 *   - assessment.list_runs / fetch_report / run / sweep.run / sweep.cancel
 *   - assessment.* event playback (progress, finding_added, sweep.progress,
 *     sweep.completed, query_failed, worker_output_rejected)
 *
 * Kept dependency-free so it loads in any Playwright runner without
 * pulling in the real bridge crate. Each instance binds to an ephemeral
 * port; specs read `bridge.url` and inject it into the page via the
 * `__vacBridgeOverride` global hook.
 */

import { WebSocket, WebSocketServer } from 'ws'
import { AddressInfo } from 'node:net'
import runsFixture from './fixtures/runs.json' with { type: 'json' }

type OutMessage =
	| AckMessage
	| { type: string; payload: Record<string, unknown> }
	| EventMessage

interface AckMessage {
	ackOf: string
	ok: boolean
	error?: { code: string; message: string }
}

interface EventMessage {
	seq: number
	session_id: string
	type: string
	payload: Record<string, unknown>
	v: 1
	ts: string
}

type InMessage = {
	type: string
	id?: string
	session_id?: string
	payload?: Record<string, unknown>
}

export interface ScriptedFailure {
	action: 'list_runs' | 'run' | 'sweep.run' | 'sweep.cancel' | 'fetch_report'
	code: string
	message: string
}

export interface MockBridgeOptions {
	failures?: ScriptedFailure[]
	/** Extra event payloads to push after the app opens the bridge socket. */
	connectEvents?: Array<{ type: string; payload: Record<string, unknown> }>
	/** Extra event payloads to push after `session/new` ack (e.g. query_failed). */
	postHandshakeEvents?: Array<{ type: string; payload: Record<string, unknown> }>
	/**
	 * When true, omit the synthetic `assessment.sweep.completed` event from
	 * `assessment.sweep.run` so the sweep stays in `running` status. Lets
	 * cancel-flow specs observe the cancel button before completion fires.
	 */
	holdSweepOpen?: boolean
}

export class MockBridge {
	private server: WebSocketServer | null = null
	private sockets = new Set<WebSocket>()
	private seqCounter = 0
	private postHandshakeEventsEmitted = false
	readonly opts: MockBridgeOptions

	constructor(opts: MockBridgeOptions = {}) {
		this.opts = opts
	}

	async start(): Promise<string> {
		this.server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
		await new Promise<void>((resolve) => this.server!.once('listening', resolve))
		const addr = this.server.address() as AddressInfo
		this.server.on('connection', (ws) => this.handleConnection(ws))
		return `ws://127.0.0.1:${addr.port}/ws`
	}

	async stop(): Promise<void> {
		for (const s of this.sockets) {
			try {
				s.close()
			} catch {
				/* ignore */
			}
		}
		await new Promise<void>((resolve, reject) =>
			this.server?.close((err) => (err ? reject(err) : resolve())),
		)
		this.server = null
	}

	private handleConnection(ws: WebSocket): void {
		this.sockets.add(ws)
		ws.on('close', () => this.sockets.delete(ws))
		this.send(ws, { type: 'welcome', payload: { server_version: 'mock-1', protocol: 'vac/1' } })
		setTimeout(() => {
			for (const ev of this.opts.connectEvents ?? []) {
				this.event(ws, ev.type, ev.payload)
			}
		}, 50)

		ws.on('message', (raw) => {
			let msg: InMessage
			try {
				msg = JSON.parse(raw.toString())
			} catch {
				return
			}
			this.dispatch(ws, msg).catch(() => {
				/* swallow; specs assert via UI */
			})
		})
	}

	private async dispatch(ws: WebSocket, msg: InMessage): Promise<void> {
		const id = msg.id ?? ''
		const type = msg.type

		if (type === 'session/new' || type === 'session.create') {
			// `session.create` is the production handshake the cockpit uses
			// (relayed through SessionPicker / e2e auto-pair). The legacy
			// `session/new` is kept so older specs and the perf harness
			// continue to ack-handshake without complaint. Both terminate in a
			// `session.ready` event so the session list / readiness view can
			// activate even when the test harness bypasses the picker.
			this.ack(ws, id, true)
			this.event(ws, 'session.ready', {
				id: 'sess-mock-1',
				profile_id: 'mock',
				project_root: '/tmp/demo-project',
				status: 'active',
				attached_clients: 1,
			})
			// In the production app the e2e override seeds `sess-mock-1` directly,
			// so no `session.create` command is required before ReadinessHub asks
			// for `assessment.list_runs`. Keep this fallback for older harnesses;
			// the primary post-handshake flush happens after list_runs below.
			this.schedulePostHandshakeEvents(ws, 200)
			return
		}

		const failure = this.opts.failures?.find((f) => actionMatches(f.action, type))
		if (failure) {
			this.ack(ws, id, false, { code: failure.code, message: failure.message })
			return
		}

		switch (type) {
			case 'assessment.list_runs':
				this.ack(ws, id, true)
				this.event(ws, 'assessment.runs_listed', {
					source: 'mock',
					runs: runsFixture.runs,
					sweeps: runsFixture.sweeps,
				})
				// The runs_listed hydrator only restores the run records; it
				// does not republish their findings. The cockpit only sees
				// findings when the bridge re-emits them via
				// `assessment.finding_added` (per-run finding stream). Replay
				// the fixture findings here so the post-handshake UI lists the
				// historical findings without the test having to drive a
				// separate fetch_report click.
				for (const run of runsFixture.runs) {
					for (const finding of run.findings ?? []) {
						this.event(ws, 'assessment.finding_added', {
							run_id: run.run_id,
							finding: {
								...finding,
								// `readFindingPayload` requires these fields to
								// hydrate the cockpit store. Fixtures keep the
								// canonical shape minimal, so the mock fills in
								// deterministic stand-ins.
								identity_hash: finding.finding_id,
								run_id: run.run_id,
							},
						})
					}
				}
				// E2E auto-pairing seeds the session in React and immediately issues
				// list_runs; no session.create message is sent. Flush scripted
				// failures/rejections only after the initial list hydration so
				// list_runs success cannot clear the injected query_failed state,
				// and worker_output_rejected is recorded before a report is opened.
				this.schedulePostHandshakeEvents(ws, 0)
				return

			case 'assessment.fetch_report': {
				const runId = (msg.payload?.run_id as string | undefined) ?? ''
				const run = runsFixture.runs.find((r) => r.run_id === runId)
				if (!run) {
					this.ack(ws, id, false, { code: 'assessment.not_found', message: 'unknown run' })
					return
				}
				this.ack(ws, id, true)
				this.event(ws, 'assessment.report_fetched', {
					source: 'mock',
					run,
					findings: run.findings,
				})
				return
			}

			case 'assessment.run': {
				const swarm = (msg.payload?.swarm as string | undefined) ?? 'rtd'
				// Use a stable run id so specs can address the live run via
				// the active-run combobox without scraping the timestamp.
				const runId = 'run-live-1'
				this.ack(ws, id, true)
				// The cockpit only renders progress for runs it already knows
				// about. `assessment.started` is what registers the live run
				// with the store; without it `setProgress` is a no-op.
				this.event(ws, 'assessment.started', {
					run_id: runId,
					swarm,
					started_at: new Date().toISOString(),
					total_checks: 2,
				})
				this.event(ws, 'assessment.progress', {
					run_id: runId,
					swarm,
					completed: 0,
					total: 2,
					phase: 'discovery',
					pass: 1,
					max_passes: 2,
				})
				await sleep(50)
				const findingId = 'fnd-live-1'
				this.event(ws, 'assessment.finding_added', {
					run_id: runId,
					finding: {
						finding_id: findingId,
						identity_hash: findingId,
						run_id: runId,
						title: 'Mock finding from live run',
						severity: 'medium',
						category: 'technical',
					},
				})
				await sleep(20)
				this.event(ws, 'assessment.progress', {
					run_id: runId,
					swarm,
					completed: 2,
					total: 2,
					phase: 'completed',
					pass: 2,
					max_passes: 2,
					verdict: 'pass',
				})
				return
			}

			case 'assessment.sweep.run': {
				const sweepId = 'sw-live-1'
				const families = (msg.payload?.families as string[] | undefined) ?? ['rtd', 'security']
				this.ack(ws, id, true)
				this.event(ws, 'assessment.sweep.started', {
					sweep_id: sweepId,
					families,
					status: 'running',
					started_at: new Date().toISOString(),
				})
				for (const [idx, fam] of families.entries()) {
					await sleep(40)
					this.event(ws, 'assessment.sweep.progress', {
						sweep_id: sweepId,
						family: fam,
						completed: idx + 1,
						total: families.length,
					})
				}
				if (!this.opts.holdSweepOpen) {
					await sleep(40)
					this.event(ws, 'assessment.sweep.completed', {
						sweep_id: sweepId,
						status: 'completed',
					})
				}
				return
			}

			case 'assessment.sweep.cancel': {
				const sweepId = (msg.payload?.sweep_id as string | undefined) ?? ''
				this.ack(ws, id, true)
				this.event(ws, 'assessment.sweep.completed', {
					sweep_id: sweepId,
					status: 'cancelled',
				})
				return
			}

			default:
				this.ack(ws, id, true)
		}
	}


	private schedulePostHandshakeEvents(ws: WebSocket, delayMs: number): void {
		if (!this.opts.postHandshakeEvents?.length || this.postHandshakeEventsEmitted) return
		this.postHandshakeEventsEmitted = true
		setTimeout(() => {
			if (ws.readyState !== WebSocket.OPEN) return
			for (const ev of this.opts.postHandshakeEvents ?? []) {
				this.event(ws, ev.type, ev.payload)
			}
		}, delayMs)
	}

	private event(ws: WebSocket, type: string, payload: Record<string, unknown>): void {
		this.seqCounter += 1
		this.send(ws, {
			seq: this.seqCounter,
			session_id: 'sess-mock-1',
			type,
			payload,
			v: 1,
			ts: new Date().toISOString(),
		})
	}

	private ack(ws: WebSocket, ackOf: string, ok: boolean, error?: { code: string; message: string }): void {
		// Match the bridge's wire format (`#[serde(rename = "ackOf")]` in
		// `apps/local-bridge/src/ws/envelope.rs`). The cockpit's `isAckFrame`
		// type guard only narrows on the camelCase `ackOf` field.
		const out: AckMessage = { ackOf, ok }
		if (error) out.error = error
		this.send(ws, out)
	}

	private send(ws: WebSocket, msg: OutMessage): void {
		try {
			ws.send(JSON.stringify(msg))
		} catch {
			/* socket closing */
		}
	}
}

function actionMatches(action: ScriptedFailure['action'], type: string): boolean {
	switch (action) {
		case 'list_runs':
			return type === 'assessment.list_runs'
		case 'run':
			return type === 'assessment.run'
		case 'sweep.run':
			return type === 'assessment.sweep.run'
		case 'sweep.cancel':
			return type === 'assessment.sweep.cancel'
		case 'fetch_report':
			return type === 'assessment.fetch_report'
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
