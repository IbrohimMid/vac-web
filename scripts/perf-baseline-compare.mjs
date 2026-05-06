#!/usr/bin/env node
// Compare current perf run against a rolling N-day baseline history.
//
// Usage:
//   node scripts/perf-baseline-compare.mjs <perf-results.json> [--history <path>] [--window <days>] [--threshold <pct>]
//
// Computes baseline p95 = p95 over all per-run p95 values from runs in the last
// <window> days, per subsystem. Flags REGRESS when current p95 exceeds baseline
// p95 by more than <threshold> percent (default 25).
//
// Exit codes: 0 = OK / first-run / no regression, 1 = regression detected, 2 = bad usage.

import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const DEFAULT_HISTORY = resolve(ROOT, ".perf-baseline/history.jsonl")

function parseArgs(argv) {
	const args = {
		input: null,
		history: DEFAULT_HISTORY,
		window: 14,
		threshold: 25,
	}
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--history") {
			args.history = resolve(argv[++i])
		} else if (argv[i] === "--window") {
			args.window = parseInt(argv[++i], 10)
		} else if (argv[i] === "--threshold") {
			args.threshold = parseFloat(argv[++i])
		} else if (!args.input) {
			args.input = resolve(argv[i])
		} else {
			console.error(`[perf-baseline-compare] unknown argument: ${argv[i]}`)
			process.exit(2)
		}
	}
	if (!args.input) {
		console.error(
			"usage: perf-baseline-compare.mjs <perf-results.json> [--history <path>] [--window <days>] [--threshold <pct>]",
		)
		process.exit(2)
	}
	return args
}

function p95(values) {
	if (values.length === 0) return null
	const sorted = [...values].sort((a, b) => a - b)
	const idx = Math.floor(sorted.length * 0.95)
	return sorted[Math.min(idx, sorted.length - 1)]
}

function main() {
	const args = parseArgs(process.argv.slice(2))
	if (!existsSync(args.input)) {
		console.error(`[perf-baseline-compare] FAIL: input not found: ${args.input}`)
		process.exit(1)
	}
	const current = JSON.parse(readFileSync(args.input, "utf8"))

	if (!existsSync(args.history)) {
		console.log(
			`[perf-baseline-compare] OK — no baseline history yet at ${args.history}; first run, baseline establishing.`,
		)
		return
	}

	const lines = readFileSync(args.history, "utf8").split("\n").filter(Boolean)
	const nowSeconds = Math.floor(Date.now() / 1000)
	const cutoffSeconds = nowSeconds - args.window * 86400
	const recent = lines
		.map(l => {
			try {
				return JSON.parse(l)
			} catch {
				return null
			}
		})
		.filter(e => e && typeof e.captured_at_unix_seconds === "number")
		.filter(e => e.captured_at_unix_seconds >= cutoffSeconds)

	if (recent.length === 0) {
		console.log(
			`[perf-baseline-compare] OK — ${lines.length} total entries but 0 in last ${args.window}d; baseline still establishing.`,
		)
		return
	}

	console.log(
		`[perf-baseline-compare] comparing current run vs ${recent.length} entries in last ${args.window}d (threshold +${args.threshold}%)`,
	)

	const subsystemHistory = new Map()
	for (const entry of recent) {
		for (const m of entry.measurements || []) {
			if (!subsystemHistory.has(m.subsystem)) subsystemHistory.set(m.subsystem, [])
			subsystemHistory.get(m.subsystem).push(m.p95_ms)
		}
	}

	let regressions = 0
	for (const m of current.measurements || []) {
		const history = subsystemHistory.get(m.subsystem) || []
		const baselineP95 = p95(history)
		if (baselineP95 === null) {
			console.log(`  ${m.subsystem.padEnd(28)} current=${m.p95_ms}ms  (no history yet)`)
			continue
		}
		const regressionPct = ((m.p95_ms - baselineP95) / baselineP95) * 100
		const flag = regressionPct > args.threshold ? "REGRESS" : "OK"
		if (flag === "REGRESS") regressions++
		console.log(
			`  ${flag.padEnd(7)} ${m.subsystem.padEnd(28)} current=${m.p95_ms}ms  baseline_p95=${baselineP95}ms  delta=${regressionPct >= 0 ? "+" : ""}${regressionPct.toFixed(1)}%`,
		)
	}

	if (regressions > 0) {
		console.error(
			`[perf-baseline-compare] FAIL: ${regressions} subsystem(s) regressed >${args.threshold}% vs baseline`,
		)
		process.exit(1)
	}
	console.log(`[perf-baseline-compare] OK — no regressions vs ${args.window}d baseline`)
}

main()
