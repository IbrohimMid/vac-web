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
	| { type: 'ack'; ack_of: string; ok: boolean; error?: { code: string; message: string }; payload?: unknown }
	| { type: string; payload: Record<string, unknown> }
	| EventMessage

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
}

export class MockBridge {
	private server: WebSocketServer | null = null
	private sockets = new Set<WebSocket>()
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

		if (type === 'session/new') {
			this.ack(ws, id, true)
			this.send(ws, {
				type: 'session/created',
				payload: { session_id: 'sess-mock-1', profile_id: 'mock' },
			})
			for (const ev of this.opts.postHandshakeEvents ?? []) {
				this.event(ws, ev.type, ev.payload)
			}
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
				this.send(ws, {
					type: 'assessment.runs_listed',
					payload: { source: 'mock', runs: runsFixture.runs, sweeps: runsFixture.sweeps },
				})
				return

			case 'assessment.fetch_report': {
				const runId = (msg.payload?.run_id as string | undefined) ?? ''
				const run = runsFixture.runs.find((r) => r.run_id === runId)
				if (!run) {
					this.ack(ws, id, false, { code: 'assessment.not_found', message: 'unknown run' })
					return
				}
				this.ack(ws, id, true)
				this.send(ws, {
					type: 'assessment.report_fetched',
					payload: { source: 'mock', run, findings: run.findings },
				})
				return
			}

			case 'assessment.run': {
				const swarm = (msg.payload?.swarm as string | undefined) ?? 'rtd'
				const runId = `run-${Date.now()}`
				this.ack(ws, id, true)
				this.send(ws, {
					type: 'assessment.progress',
					payload: { run_id: runId, swarm, phase: 'discovery', pass: 1, max_passes: 2 },
				})
				await sleep(50)
				this.send(ws, {
					type: 'assessment.finding_added',
					payload: {
						run_id: runId,
						finding: {
							finding_id: `fnd-${Date.now()}`,
							title: 'Mock finding from live run',
							severity: 'medium',
							category: 'technical',
						},
					},
				})
				await sleep(20)
				this.send(ws, {
					type: 'assessment.progress',
					payload: {
						run_id: runId,
						swarm,
						phase: 'completed',
						pass: 2,
						max_passes: 2,
						verdict: 'pass',
					},
				})
				return
			}

			case 'assessment.sweep.run': {
				const sweepId = `sw-${Date.now()}`
				const families = (msg.payload?.families as string[] | undefined) ?? ['rtd', 'security']
				this.ack(ws, id, true)
				this.send(ws, {
					type: 'assessment.sweep.started',
					payload: { sweep_id: sweepId, families },
				})
				for (const [idx, fam] of families.entries()) {
					await sleep(40)
					this.send(ws, {
						type: 'assessment.sweep.progress',
						payload: { sweep_id: sweepId, family: fam, completed: idx + 1, total: families.length },
					})
				}
				await sleep(40)
				this.send(ws, {
					type: 'assessment.sweep.completed',
					payload: { sweep_id: sweepId, status: 'completed' },
				})
				return
			}

			case 'assessment.sweep.cancel': {
				const sweepId = (msg.payload?.sweep_id as string | undefined) ?? ''
				this.ack(ws, id, true)
				this.send(ws, {
					type: 'assessment.sweep.completed',
					payload: { sweep_id: sweepId, status: 'cancelled' },
				})
				return
			}

			default:
				this.ack(ws, id, true)
		}
	}


	private event(ws: WebSocket, type: string, payload: Record<string, unknown>): void {
		this.send(ws, {
			seq: Date.now(),
			session_id: 'sess-mock-1',
			type,
			payload,
			v: 1,
			ts: new Date().toISOString(),
		})
	}

	private ack(ws: WebSocket, ackOf: string, ok: boolean, error?: { code: string; message: string }): void {
		const out: OutMessage = { type: 'ack', ack_of: ackOf, ok }
		if (error) (out as { error?: typeof error }).error = error
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
