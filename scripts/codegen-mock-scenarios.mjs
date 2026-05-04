#!/usr/bin/env node
// Slice 34: codegen pipeline for mock-engine scenarios.
//
// Reads every `tools/mock-engine/scenarios/*.yaml` and emits a Rust
// catalog at `tools/mock-engine/src/generated/scenario_catalog.rs`.
//
// Two outputs:
//   1. SCENARIO_CATALOG (metadata-only): id, status, replacement,
//      input command, timeline event ids, assertions. Used by drift-gate
//      tests and human inspection.
//   2. RUNTIME_SCENARIO_CATALOG: only scenarios with `runtime_dispatch:
//      true`. Includes raw JSON timeline payloads + final_response +
//      state_seeds so `scenarios::handle` can drive the timeline at
//      runtime, short-circuiting before delegating to legacy_scenarios.
//
// Usage:
//   node scripts/codegen-mock-scenarios.mjs              # write
//   node scripts/codegen-mock-scenarios.mjs --check      # CI drift gate

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import yaml from 'js-yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const SCENARIOS_DIR = join(REPO, 'tools/mock-engine/scenarios');
const OUT_PATH = join(REPO, 'tools/mock-engine/src/generated/scenario_catalog.rs');

const MODE_CHECK = process.argv.includes('--check');

const ALLOWED_STATUSES = new Set([
	'legacy_mock_only',
	'future_when_backend_lands',
	'production_parity',
	'fixture_only',
]);

const ALLOWED_GENERATORS = new Set([
	'next_shell_id',
	'next_msg_id',
	'next_tool_call_id',
	'next_job_id',
	'session_id',
	'release_deploy_id',
	'release_deploy_commit',
	'release_notes_id',
	'mention_search_results',
	'handoff_packet_id',
	'repo_default_base_commit_sha',
	'repo_default_repo_ref',
	'repo_default_worktree_digest',
	// Pass #34: handoff.dispatch_local conditional branching primitives.
	'executor_session_id',
	'handoff_dispatch_outcome',
	// Pass #35: foreach primitive smoke (returns fixed 3-item JSON array of objects).
	'debug_smoke_items',
	// Pass #36: assessment.run port via foreach over @assessment_family_catalog + condition primitive on is_failure.
	'assessment_run_id',
	'assessment_is_failure',
	'assessment_family_catalog',
	'assessment_family_size',
	'assessment_scope_json',
	'assessment_connector_snapshots_json',
	'assessment_failure_rejected_inner_json',
	'assessment_failure_failed_inner_json',
	'assessment_verdict',
	'assessment_release_score',
	'assessment_rtd_state',
	'assessment_rtd_summary',
	'assessment_rtd_satisfied',
	'assessment_rtd_blockers_json',
]);

function loadScenarios() {
	if (!existsSync(SCENARIOS_DIR)) return [];
	const files = readdirSync(SCENARIOS_DIR)
		.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
		.sort();
	return files.map((file) => {
		const path = join(SCENARIOS_DIR, file);
		const raw = readFileSync(path, 'utf8');
		const doc = yaml.load(raw);
		return { file, path, doc };
	});
}

function validate({ file, doc }) {
	const errs = [];
	if (!doc || typeof doc !== 'object') {
		errs.push(`${file}: top-level YAML must be a mapping`);
		return errs;
	}
	if (typeof doc.scenario !== 'string' || !/^[a-z][a-z0-9_]*$/.test(doc.scenario)) {
		errs.push(`${file}: 'scenario' must be a snake_case identifier`);
	}
	if (typeof doc.status !== 'string' || !ALLOWED_STATUSES.has(doc.status)) {
		errs.push(`${file}: 'status' must be one of ${[...ALLOWED_STATUSES].join('/')}`);
	}
	if (!doc.input || typeof doc.input.command !== 'string') {
		errs.push(`${file}: 'input.command' is required`);
	}
	if (!Array.isArray(doc.timeline)) {
		errs.push(`${file}: 'timeline' must be an array`);
	}
	if (!Array.isArray(doc.assertions)) {
		errs.push(`${file}: 'assertions' must be an array of strings`);
	}
	if (doc.runtime_dispatch !== undefined && typeof doc.runtime_dispatch !== 'boolean') {
		errs.push(`${file}: 'runtime_dispatch' must be a boolean if present`);
	}
	if (doc.state_seeds !== undefined) {
		if (typeof doc.state_seeds !== 'object' || Array.isArray(doc.state_seeds)) {
			errs.push(`${file}: 'state_seeds' must be an object`);
		} else {
			for (const [k, v] of Object.entries(doc.state_seeds)) {
				if (typeof v !== 'string') {
					errs.push(`${file}: state_seeds.${k} must be a string`);
				} else if (v.startsWith('@') && !ALLOWED_GENERATORS.has(v.slice(1))) {
					errs.push(`${file}: state_seeds.${k} unknown generator '${v}'. Allowed: @${[...ALLOWED_GENERATORS].join(', @')}`);
				}
			}
		}
	}
	if (doc.final_response !== undefined && (typeof doc.final_response !== 'object' || Array.isArray(doc.final_response))) {
		errs.push(`${file}: 'final_response' must be an object`);
	}
	// Pass #34: validate optional `condition` block on each timeline step.
	// Single-equality only — { binding: string, equals: string }. No operators.
	if (Array.isArray(doc.timeline)) {
		for (let i = 0; i < doc.timeline.length; i++) {
			const step = doc.timeline[i];
			if (!step || step.condition === undefined) continue;
			if (typeof step.condition !== 'object' || Array.isArray(step.condition)) {
				errs.push(`${file}: timeline[${i}].condition must be an object`);
				continue;
			}
			if (typeof step.condition.binding !== 'string') {
				errs.push(`${file}: timeline[${i}].condition.binding must be a string`);
			}
			if (typeof step.condition.equals !== 'string') {
				errs.push(`${file}: timeline[${i}].condition.equals must be a string`);
			}
			for (const k of Object.keys(step.condition)) {
				if (k !== 'binding' && k !== 'equals') {
					errs.push(`${file}: timeline[${i}].condition unknown key '${k}'; allowed: binding, equals`);
				}
			}
		}
	}
	// Pass #35: validate optional `foreach` loop primitive on each timeline step.
	// foreach iterates a JSON-array binding; body must be an array of steps WITHOUT
	// nested foreach (single-level iteration only). Required keys on foreach:
	// binding, as. Optional: index_var. Step with foreach must NOT also set event.
	if (Array.isArray(doc.timeline)) {
		for (let i = 0; i < doc.timeline.length; i++) {
			const step = doc.timeline[i];
			if (!step || step.foreach === undefined) continue;
			if (typeof step.foreach !== 'object' || Array.isArray(step.foreach)) {
				errs.push(`${file}: timeline[${i}].foreach must be an object`);
				continue;
			}
			if (typeof step.foreach.binding !== 'string') {
				errs.push(`${file}: timeline[${i}].foreach.binding must be a string`);
			}
			if (typeof step.foreach.as !== 'string') {
				errs.push(`${file}: timeline[${i}].foreach.as must be a string`);
			}
			if (step.foreach.index_var !== undefined && typeof step.foreach.index_var !== 'string') {
				errs.push(`${file}: timeline[${i}].foreach.index_var must be a string when set`);
			}
			for (const k of Object.keys(step.foreach)) {
				if (k !== 'binding' && k !== 'as' && k !== 'index_var') {
					errs.push(`${file}: timeline[${i}].foreach unknown key '${k}'; allowed: binding, as, index_var`);
				}
			}
			if (!Array.isArray(step.body)) {
				errs.push(`${file}: timeline[${i}].body must be an array (foreach loop body)`);
			} else {
				for (let j = 0; j < step.body.length; j++) {
					const inner = step.body[j];
					if (inner && inner.foreach !== undefined) {
						errs.push(`${file}: timeline[${i}].body[${j}] nested foreach not allowed (single-level iteration only)`);
					}
					if (inner && typeof inner.event !== 'string') {
						errs.push(`${file}: timeline[${i}].body[${j}].event must be a string`);
					}
				}
			}
			if (step.event !== undefined) {
				errs.push(`${file}: timeline[${i}] cannot have both 'foreach' and 'event'`);
			}
		}
	}
	// Audit fixup (post-Pass #36): per-step schema firewall. Validates the common step
	// fields (event / after_ms / payload / payload_template / state_seeds_after) on every
	// non-foreach step plus every foreach body step. Catches type mismatches at codegen
	// time so a typo in YAML never reaches the runtime as a silently-aborting scenario.
	const validateStepShape = (where, step) => {
		const e = [];
		const isForeach = step && step.foreach !== undefined;
		if (!isForeach && typeof step.event !== 'string') {
			e.push(`${file}: ${where}.event must be a string`);
		}
		if (
			step.after_ms !== undefined &&
			(typeof step.after_ms !== 'number' || !Number.isInteger(step.after_ms) || step.after_ms < 0)
		) {
			e.push(`${file}: ${where}.after_ms must be a non-negative integer`);
		}
		if (
			step.payload !== undefined &&
			(typeof step.payload !== 'object' || Array.isArray(step.payload) || step.payload === null)
		) {
			e.push(`${file}: ${where}.payload must be an object`);
		}
		if (step.payload_template !== undefined && typeof step.payload_template !== 'string') {
			e.push(`${file}: ${where}.payload_template must be a string`);
		}
		if (step.payload !== undefined && step.payload_template !== undefined) {
			e.push(`${file}: ${where} cannot set both 'payload' and 'payload_template'`);
		}
		if (step.state_seeds_after !== undefined) {
			if (
				typeof step.state_seeds_after !== 'object' ||
				Array.isArray(step.state_seeds_after) ||
				step.state_seeds_after === null
			) {
				e.push(`${file}: ${where}.state_seeds_after must be an object`);
			} else {
				for (const [k, v] of Object.entries(step.state_seeds_after)) {
					if (typeof v !== 'string') {
						e.push(`${file}: ${where}.state_seeds_after.${k} must be a string`);
					}
				}
			}
		}
		return e;
	};
	if (Array.isArray(doc.timeline)) {
		for (let i = 0; i < doc.timeline.length; i++) {
			const step = doc.timeline[i];
			if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
			errs.push(...validateStepShape(`timeline[${i}]`, step));
			if (step.foreach !== undefined && Array.isArray(step.body)) {
				for (let j = 0; j < step.body.length; j++) {
					const inner = step.body[j];
					if (!inner || typeof inner !== 'object' || Array.isArray(inner)) continue;
					errs.push(...validateStepShape(`timeline[${i}].body[${j}]`, inner));
				}
			}
		}
	}
	return errs;
}

function rustEscape(s) {
	return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function render(scenarios) {
	const lines = [];
	lines.push('// AUTO-GENERATED by scripts/codegen-mock-scenarios.mjs.');
	lines.push('// Source of truth: tools/mock-engine/scenarios/*.yaml.');
	lines.push('// Run `pnpm codegen:scenarios` after editing a YAML scenario.');
	lines.push('// Do not edit by hand.');
	lines.push('');
	lines.push('#![allow(dead_code)]');
	lines.push('');
	lines.push('#[derive(Debug, Clone, Copy, PartialEq, Eq)]');
	lines.push('pub enum ScenarioStatus {');
	for (const s of [...ALLOWED_STATUSES].sort()) {
		const pascal = s
			.split('_')
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join('');
		lines.push(`    ${pascal},`);
	}
	lines.push('}');
	lines.push('');
	lines.push('#[derive(Debug, Clone, Copy)]');
	lines.push('pub struct ScenarioEntry {');
	lines.push('    pub id: &\'static str,');
	lines.push('    pub status: ScenarioStatus,');
	lines.push('    pub replacement: Option<&\'static str>,');
	lines.push('    pub input_command: &\'static str,');
	lines.push('    pub timeline_events: &\'static [&\'static str],');
	lines.push('    pub assertions: &\'static [&\'static str],');
	lines.push('}');
	lines.push('');
	lines.push(`pub const SCENARIO_CATALOG: [ScenarioEntry; ${scenarios.length}] = [`);
	for (const { doc } of scenarios) {
		const pascal = doc.status
			.split('_')
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join('');
		const replacement =
			typeof doc.replacement === 'string' ? `Some("${rustEscape(doc.replacement)}")` : 'None';
		// Pass #35: foreach steps expose body event names instead of their own (which is empty).
		const flattenEventNames = (steps) =>
			(steps ?? []).flatMap((t) => (t.foreach !== undefined ? flattenEventNames(t.body) : [t.event ?? '']));
		const events = flattenEventNames(doc.timeline)
			.map((e) => `"${rustEscape(e)}"`)
			.join(', ');
		const assertions = (doc.assertions ?? [])
			.map((a) => `"${rustEscape(a)}"`)
			.join(', ');
		lines.push('    ScenarioEntry {');
		lines.push(`        id: "${rustEscape(doc.scenario)}",`);
		lines.push(`        status: ScenarioStatus::${pascal},`);
		lines.push(`        replacement: ${replacement},`);
		lines.push(`        input_command: "${rustEscape(doc.input.command)}",`);
		lines.push(`        timeline_events: &[${events}],`);
		lines.push(`        assertions: &[${assertions}],`);
		lines.push('    },');
	}
	lines.push('];');
	lines.push('');

	// --- Runtime catalog (only scenarios with runtime_dispatch: true) ---
	const runtime = scenarios.filter(({ doc }) => doc.runtime_dispatch === true);
	lines.push('#[derive(Debug, Clone, Copy)]');
	lines.push('pub struct RuntimeTimelineStep {');
	lines.push('    pub event: &\'static str,');
	lines.push('    pub after_ms: u64,');
	lines.push('    /// JSON object string with ${var} placeholders rendered at dispatch.');
	lines.push('    pub payload_json: &\'static str,');
	lines.push('    /// Raw JSON template; when Some, ${var} placeholders are substituted');
	lines.push('    /// directly in the template string BEFORE serde_json::from_str. Lets typed');
	lines.push('    /// JSON-value bindings (e.g. array results from @mention_search_results)');
	lines.push('    /// splice in as actual arrays/objects rather than string blobs.');
	lines.push('    pub payload_template_json: Option<&\'static str>,');
	lines.push('    /// Multi-event ledger (Pass #33): bindings to insert AFTER this step is rendered.');
	lines.push('    /// Subsequent steps see these in their bindings map.');
	lines.push('    pub state_seeds_after: &\'static [RuntimeStateSeed],');
	lines.push('    /// Pass #34: optional single-equality skip primitive. When Some, the step is emitted');
	lines.push('    /// only if `bindings[condition.binding] == condition.equals` at dispatch time.');
	lines.push('    /// Missing bindings compare against the empty string. No operators, no nesting.');
	lines.push('    pub condition: Option<RuntimeStepCondition>,');
	lines.push('    /// Pass #35: optional foreach loop primitive. When Some, this step iterates the JSON');
	lines.push('    /// array stored in `bindings[foreach.binding]` (set by a state_seed generator that');
	lines.push('    /// returns a JSON-encoded array of objects). Body steps execute per-item with');
	lines.push('    /// extended bindings: `{as_prefix}.{key}` for each object field plus `{index_var}`');
	lines.push('    /// (when non-empty) for the 0-based index. event/payload_json/etc on this step are');
	lines.push('    /// ignored when foreach is Some. Single-level iteration only (codegen rejects nesting).');
	lines.push('    pub foreach: Option<RuntimeForeach>,');
	lines.push('}');
	lines.push('');
	lines.push('#[derive(Debug, Clone, Copy)]');
	lines.push('pub struct RuntimeForeach {');
	lines.push('    pub binding: &\'static str,');
	lines.push('    pub as_prefix: &\'static str,');
	lines.push('    /// Empty string when YAML omits index_var (no index binding emitted per-iter).');
	lines.push('    pub index_var: &\'static str,');
	lines.push('    pub body: &\'static [RuntimeTimelineStep],');
	lines.push('}');
	lines.push('');
	lines.push('#[derive(Debug, Clone, Copy)]');
	lines.push('pub struct RuntimeStateSeed {');
	lines.push('    pub var: &\'static str,');
	lines.push('    /// Either a literal string (used verbatim) or `@generator` (e.g. `@next_shell_id`).');
	lines.push('    pub value: &\'static str,');
	lines.push('}');
	lines.push('');
	lines.push('#[derive(Debug, Clone, Copy)]');
	lines.push('pub struct RuntimeStepCondition {');
	lines.push('    pub binding: &\'static str,');
	lines.push('    pub equals: &\'static str,');
	lines.push('}');
	lines.push('');
	lines.push('#[derive(Debug, Clone, Copy)]');
	lines.push('pub struct RuntimeScenarioEntry {');
	lines.push('    pub id: &\'static str,');
	lines.push('    pub input_command: &\'static str,');
	lines.push('    pub state_seeds: &\'static [RuntimeStateSeed],');
	lines.push('    pub timeline: &\'static [RuntimeTimelineStep],');
	lines.push('    /// JSON object string with ${var} placeholders, rendered as the JSON-RPC response.result.');
	lines.push('    pub final_response_json: Option<&\'static str>,');
	lines.push('}');
	lines.push('');
	lines.push(`pub const RUNTIME_SCENARIO_CATALOG: [RuntimeScenarioEntry; ${runtime.length}] = [`);
	for (const { doc } of runtime) {
		const seeds = Object.entries(doc.state_seeds ?? {})
			.map(([k, v]) => `RuntimeStateSeed { var: "${rustEscape(k)}", value: "${rustEscape(v)}" }`)
			.join(', ');
		const renderStep = (t, depth = 0) => {
			if (t.foreach !== undefined) {
				if (depth > 0) throw new Error('nested foreach rejected by validator');
				const bodySteps = (t.body ?? []).map((b) => renderStep(b, depth + 1)).join(', ');
				const indexVar = typeof t.foreach.index_var === 'string' ? t.foreach.index_var : '';
				// Audit fixup (post-Pass #36): outer foreach steps now honor `condition`. The
				// runtime gates the entire loop via condition_matches in try_runtime_dispatch.
				const foreachConditionField = t.condition
					? `Some(RuntimeStepCondition { binding: \"${rustEscape(t.condition.binding)}\", equals: \"${rustEscape(t.condition.equals)}\" })`
					: 'None';
				return `RuntimeTimelineStep { event: \"\", after_ms: 0, payload_json: \"{}\", payload_template_json: None, state_seeds_after: &[], condition: ${foreachConditionField}, foreach: Some(RuntimeForeach { binding: \"${rustEscape(t.foreach.binding)}\", as_prefix: \"${rustEscape(t.foreach.as)}\", index_var: \"${rustEscape(indexVar)}\", body: &[${bodySteps}] }) }`;
			}
			const payloadJson = JSON.stringify(t.payload ?? {});
			const payloadTemplate = t.payload_template;
			const payloadTemplateField = payloadTemplate
				? `Some(\"${rustEscape(payloadTemplate)}\")`
				: 'None';
			const seedsAfter = Object.entries(t.state_seeds_after ?? {})
				.map(([k, v]) => `RuntimeStateSeed { var: \"${rustEscape(k)}\", value: \"${rustEscape(v)}\" }`)
				.join(', ');
			const conditionField = t.condition
				? `Some(RuntimeStepCondition { binding: \"${rustEscape(t.condition.binding)}\", equals: \"${rustEscape(t.condition.equals)}\" })`
				: 'None';
			return `RuntimeTimelineStep { event: \"${rustEscape(t.event ?? '')}\", after_ms: ${t.after_ms ?? 0}, payload_json: \"${rustEscape(payloadJson)}\", payload_template_json: ${payloadTemplateField}, state_seeds_after: &[${seedsAfter}], condition: ${conditionField}, foreach: None }`;
		};
		const steps = (doc.timeline ?? []).map((t) => renderStep(t)).join(', ');
		const finalResp = doc.final_response
			? `Some("${rustEscape(JSON.stringify(doc.final_response))}")`
			: 'None';
		lines.push('    RuntimeScenarioEntry {');
		lines.push(`        id: "${rustEscape(doc.scenario)}",`);
		lines.push(`        input_command: "${rustEscape(doc.input.command)}",`);
		lines.push(`        state_seeds: &[${seeds}],`);
		lines.push(`        timeline: &[${steps}],`);
		lines.push(`        final_response_json: ${finalResp},`);
		lines.push('    },');
	}
	lines.push('];');
	lines.push('');

	lines.push("#[cfg(test)]");
	lines.push('mod tests {');
	lines.push('    use super::*;');
	lines.push('');
	lines.push('    #[test]');
	lines.push('    fn ids_are_unique() {');
	lines.push('        let mut ids: Vec<&str> = SCENARIO_CATALOG.iter().map(|s| s.id).collect();');
	lines.push('        ids.sort();');
	lines.push('        for w in ids.windows(2) {');
	lines.push('            assert_ne!(w[0], w[1], "duplicate scenario id: {}", w[0]);');
	lines.push('        }');
	lines.push('    }');
	lines.push('');
	lines.push('    #[test]');
	lines.push('    fn input_commands_are_well_formed() {');
	lines.push('        for s in &SCENARIO_CATALOG {');
		lines.push('            assert!(');
		lines.push('                !s.input_command.is_empty(),');
		lines.push('                "empty input.command in {}",');
		lines.push('                s.id');
		lines.push('            );');
	lines.push('        }');
	lines.push('    }');
	lines.push('');
	lines.push('    #[test]');
	lines.push('    fn runtime_entries_reference_known_scenarios() {');
	lines.push('        let known: std::collections::HashSet<&str> =');
	lines.push('            SCENARIO_CATALOG.iter().map(|s| s.id).collect();');
	lines.push('        for r in &RUNTIME_SCENARIO_CATALOG {');
		lines.push('            assert!(');
		lines.push('                known.contains(r.id),');
		lines.push('                "runtime scenario {} not in catalog",');
		lines.push('                r.id');
		lines.push('            );');
	lines.push('        }');
	lines.push('    }');
	lines.push('');
	lines.push('    #[test]');
	lines.push('    fn runtime_payloads_parse_as_json() {');
	lines.push('        for r in &RUNTIME_SCENARIO_CATALOG {');
	lines.push('            for s in r.timeline {');
	lines.push('                serde_json::from_str::<serde_json::Value>(s.payload_json)');
	lines.push('                    .unwrap_or_else(|e| panic!("bad payload json in {}: {}", r.id, e));');
	lines.push('            }');
	lines.push('            if let Some(j) = r.final_response_json {');
	lines.push('                serde_json::from_str::<serde_json::Value>(j)');
	lines.push('                    .unwrap_or_else(|e| panic!("bad final_response json in {}: {}", r.id, e));');
	lines.push('            }');
	lines.push('        }');
	lines.push('    }');
	lines.push('}');
	lines.push('');
	return lines.join('\n');
}

const scenarios = loadScenarios();
const errors = scenarios.flatMap(validate);
if (errors.length) {
	console.error('[codegen-mock-scenarios] schema errors:');
	for (const e of errors) console.error('  -', e);
	process.exit(1);
}

const body = render(scenarios);
mkdirSync(dirname(OUT_PATH), { recursive: true });

if (MODE_CHECK) {
	const current = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : '';
	if (current !== body) {
		console.error(`[codegen-mock-scenarios] drift detected at ${relative(REPO, OUT_PATH)}`);
		console.error('Run `pnpm codegen:scenarios` and commit the result.');
		process.exit(1);
	}
	const runtimeCount = scenarios.filter(({ doc }) => doc.runtime_dispatch === true).length;
	console.log(`[codegen-mock-scenarios] OK \u2014 ${scenarios.length} scenario(s), ${runtimeCount} runtime-dispatched, match committed catalog.`);
} else {
	writeFileSync(OUT_PATH, body);
	const runtimeCount = scenarios.filter(({ doc }) => doc.runtime_dispatch === true).length;
	console.log(`[codegen-mock-scenarios] wrote ${scenarios.length} scenario(s) (${runtimeCount} runtime-dispatched) to ${relative(REPO, OUT_PATH)}.`);
}
