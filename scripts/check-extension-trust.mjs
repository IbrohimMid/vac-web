#!/usr/bin/env node
// Drift gate: verifies `config/extension-trust.yaml` is well-formed and that
// every referenced extension matches a known runtime extension manifest.
//
// Phase 2 stub: structural validation only. Phase 2 full impl will:
// 1. Cross-check `publishers[]` pubkeys against signed-release infrastructure.
// 2. Cross-check `extensions[]` ids against the runtime extension registry.
// 3. Verify revocation list entries reference real prior allowlist entries.
//
// Exit codes: 0 = OK, 1 = structural error.

import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const CONFIG_PATH = resolve(ROOT, "config/extension-trust.yaml")

const VALID_TIERS = new Set([
	"allowed_bundled",
	"allowed_signed",
	"quarantined",
	"revoked",
])
const VALID_SOURCES = new Set(["bundled", "signed"])

function fail(msg) {
	console.error(`[check-extension-trust] FAIL: ${msg}`)
	process.exit(1)
}

function main() {
	if (!existsSync(CONFIG_PATH)) {
		fail(`config not found at ${CONFIG_PATH}`)
	}

	const raw = readFileSync(CONFIG_PATH, "utf8")
	let doc
	try {
		doc = YAML.parse(raw)
	} catch (e) {
		fail(`yaml parse error: ${e.message}`)
	}

	if (!doc || typeof doc !== "object") fail("config must be a yaml mapping")
	if (doc.version !== 1) fail(`unsupported version (got ${doc.version}, expected 1)`)
	if (typeof doc.allow_unsigned !== "boolean") fail("allow_unsigned must be boolean")
	if (!Array.isArray(doc.publishers)) fail("publishers must be an array")
	if (!Array.isArray(doc.extensions)) fail("extensions must be an array")

	const seenIds = new Set()
	for (const [i, ext] of doc.extensions.entries()) {
		if (!ext || typeof ext !== "object") fail(`extensions[${i}] must be an object`)
		if (typeof ext.id !== "string" || ext.id.length === 0) {
			fail(`extensions[${i}].id must be a non-empty string`)
		}
		if (seenIds.has(ext.id)) fail(`duplicate extension id: ${ext.id}`)
		seenIds.add(ext.id)
		if (!VALID_TIERS.has(ext.tier)) {
			fail(`extensions[${i}] (${ext.id}).tier must be one of ${[...VALID_TIERS].join(", ")}`)
		}
		if (!VALID_SOURCES.has(ext.source)) {
			fail(`extensions[${i}] (${ext.id}).source must be one of ${[...VALID_SOURCES].join(", ")}`)
		}
		if (ext.source === "signed" && (!ext.publisher || typeof ext.publisher !== "string")) {
			fail(`extensions[${i}] (${ext.id}) source=signed requires publisher (string)`)
		}
	}

	console.log(
		`[check-extension-trust] OK — schema v${doc.version}, ` +
			`allow_unsigned=${doc.allow_unsigned}, ` +
			`publishers=${doc.publishers.length}, ` +
			`extensions=${doc.extensions.length}`,
	)
}

main()
