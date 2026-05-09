import { defineConfig, devices } from '@playwright/test'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const configDir = dirname(fileURLToPath(import.meta.url))

/**
 * Playwright config for the web cockpit end-to-end suite.
 *
 * The suite runs against a real `vite preview` build (no Vite HMR /
 * tooling reaches into the browser) talking to the deterministic mock
 * bridge in `tests/e2e/mock-bridge.ts`. The mock bridge speaks the
 * subset of the WS protocol that the assessment hub needs (welcome,
 * session/new, assessment.list_runs / run / sweep.run / sweep.cancel,
 * and assessment.* events) and ships canned fixtures so specs can
 * assert on stable UI text without flake.
 *
 * Install once before running locally:
 *   pnpm exec playwright install chromium
 *
 * Then:
 *   pnpm -C apps/web e2e
 */
export default defineConfig({
	testDir: './tests/e2e',
	timeout: 30_000,
	expect: { timeout: 5_000 },
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	use: {
		baseURL: 'http://127.0.0.1:4173',
		trace: 'on-first-retry',
		video: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
		{
			// F2.5 perf driver project — runs `tests/perf/*.spec.ts` only.
			// Driven by `tools/perf/src/scenarios/topbar_interaction.rs`,
			// which spawns `pnpm -F web exec playwright test --project=perf`
			// and reads the JSON payload written via `VAC_PERF_OUTPUT`.
			name: 'perf',
			testDir: './tests/perf',
			timeout: 180_000,
			use: { ...devices['Desktop Chrome'] },
		},
	],
	webServer: {
		// Build first so we exercise the production bundle (matches what
		// shows up in size-limit + size budgets).
		command: 'pnpm exec vite build && pnpm exec vite preview --port 4173 --strictPort',
		url: 'http://127.0.0.1:4173',
		cwd: configDir,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		stdout: 'pipe',
		stderr: 'pipe',
	},
})
