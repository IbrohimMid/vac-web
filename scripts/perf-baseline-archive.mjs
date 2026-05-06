#!/usr/bin/env node
// Append a perf measurement run to the rolling baseline history (JSONL).
//
// Usage:
//   node scripts/perf-baseline-archive.mjs <perf-results.json> [--history <path>]
//
// The history file is one JSON object per line, append-only. Used together with
// scripts/perf-baseline-compare.mjs to detect regressions vs an N-day rolling
// p95-of-p95.
//
// Exit codes: 0 = OK, 1 = invalid input, 2 = bad usage.

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const DEFAULT_HISTORY = resolve(ROOT, ".perf-baseline/history.jsonl")

function parseArgs(argv) {
	const args = { input: null, history: DEFAULT_HISTORY }
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--history") {
			args.history = resolve(argv[++i])
		} else if (!args.input) {
			args.input = resolve(argv[i])
		} else {
			console.error(`[perf-baseline-archive] unknown argument: ${argv[i]}`)
			process.exit(2)
		}
	}
	if (!args.input) {
		console.error("usage: perf-baseline-archive.mjs <perf-results.json> [--history <path>]")
		process.exit(2)
	}
	return args
}

function main() {
	const args = parseArgs(process.argv.slice(2))
	if (!existsSync(args.input)) {
		console.error(`[perf-baseline-archive] FAIL: input not found: ${args.input}`)
		process.exit(1)
	}
	let report
	try {
		report = JSON.parse(readFileSync(args.input, "utf8"))
	} catch (e) {
		console.error(`[perf-baseline-archive] FAIL: invalid JSON in ${args.input}: ${e.message}`)
		process.exit(1)
	}
	if (!Array.isArray(report.measurements)) {
		console.error(`[perf-baseline-archive] FAIL: report has no measurements[] array`)
		process.exit(1)
	}

	const entry = {
		captured_at_unix_seconds: report.captured_at_unix_seconds,
		captured_at_iso: report.captured_at_unix_seconds
			? new Date(report.captured_at_unix_seconds * 1000).toISOString()
			: null,
		duration_seconds: report.duration_seconds,
		phase: report.phase,
		measurement_only: report.measurement_only,
		measurements: report.measurements.map(m => ({
			subsystem: m.subsystem,
			p50_ms: m.p50_ms,
			p95_ms: m.p95_ms,
			p99_ms: m.p99_ms,
			sample_count: m.sample_count,
		})),
	}

	mkdirSync(dirname(args.history), { recursive: true })
	const line = JSON.stringify(entry) + "\n"
	if (existsSync(args.history)) {
		appendFileSync(args.history, line)
	} else {
		writeFileSync(args.history, line)
	}
	console.log(
		`[perf-baseline-archive] OK — appended 1 entry (${entry.measurements.length} subsystems) to ${args.history}`,
	)
}

main()
