/**
 * Sweep cockpit end-to-end specs (P5).
 *
 * The 8 specs here are the contract tests for the assessment cockpit
 * surfaced in `ReadinessHub`, the run detail pane, and the sweep history
 * card. They drive the production bundle (built once by playwright's
 * webServer entry) against the in-process [`MockBridge`] so we can
 * assert on real DOM, real ack timing, and real event ordering without
 * needing a worker process.
 *
 * Each spec:
 *   1. spawns a fresh `MockBridge` with the failure / event script it
 *      needs,
 *   2. injects the bridge URL into the page via
 *      `globalThis.__vacBridgeOverride` *before* the React app mounts,
 *   3. drives the cockpit through user-visible actions (no internal
 *      store reads),
 *   4. asserts on user-visible strings.
 *
 * Selectors prefer stable `data-testid` hooks for action targets
 * (Run / Run sweep / Cancel / Retry buttons, sweep-history rows).
 * Content assertions (row labels, finding text, banner copy) stay on
 * `getByText` because the spec is verifying that the UI renders that
 * exact copy. The testid contract is documented in `README.md`.
 */

import { test, expect, Page } from '@playwright/test'
import { MockBridge, MockBridgeOptions } from './mock-bridge'

declare global {
	interface Window {
		__vacBridgeOverride?: string
	}
}

async function bootCockpit(
	page: Page,
	bridgeOpts: MockBridgeOptions = {},
): Promise<MockBridge> {
	const bridge = new MockBridge(bridgeOpts)
	const url = await bridge.start()
	await page.addInitScript((wsUrl: string) => {
		window.__vacBridgeOverride = wsUrl
	}, url)
	await page.goto('/')
	await page.getByRole('link', { name: 'Assess' }).click()
	await expect(page.getByTestId('run-assessment-button')).toBeVisible()
	return bridge
}

test.describe('sweep cockpit', () => {
	let bridge: MockBridge | null = null

	test.afterEach(async () => {
		if (bridge) {
			await bridge.stop()
			bridge = null
		}
	})

	test('lists historical runs after handshake', async ({ page }) => {
		bridge = await bootCockpit(page)
		// `assessment.runs_listed` auto-activates the first run, so the
		// findings list only renders findings for that run. Verify both
		// fixture findings appear by toggling the Active run dropdown.
		const activeRunSelect = page.getByTestId('assessment-active-run-select')
		await expect(
			page.getByText('All RTD checks green', { exact: false }),
		).toBeVisible()
		await activeRunSelect.selectOption('run-002')
		await expect(
			page.getByText('TLS missing on staging endpoint', { exact: false }),
		).toBeVisible()
	})

	test('selecting a run loads its findings', async ({ page }) => {
		bridge = await bootCockpit(page)
		// Switch to the security run so the verdict (warn) and family
		// (security) badges render the values under test.
		await page
			.getByTestId('assessment-active-run-select')
			.selectOption('run-002')
		await expect(page.getByText('TLS missing on staging endpoint', { exact: false })).toBeVisible()
		await expect(page.getByText('Verdict: warn')).toBeVisible()
		await expect(page.getByText('security · warn')).toBeVisible()
	})

	test('running a single-family assessment shows live progress', async ({ page }) => {
		bridge = await bootCockpit(page)
		await page.getByTestId('run-assessment-button').click()
		// Switch the active-run selector to the freshly-started live run so
		// the progress bar and finding list focus on it. The mock uses a
		// stable id (`run-live-1`) for this purpose.
		await page
			.getByTestId('assessment-active-run-select')
			.selectOption('run-live-1')
		// The mock streams progress quickly so by the time we select the run
		// the progress bar is on `pass 2/2 · completed`. Assert on the final
		// state plus the streamed finding to prove the live-run pipeline
		// (started -> progress -> finding_added -> progress) reached the UI.
		await expect(page.getByText('Mock finding from live run', { exact: false })).toBeVisible()
		await expect(page.getByText(/pass 2\/2/i).first()).toBeVisible()
	})

	test('sweep run streams progress per family', async ({ page }) => {
		bridge = await bootCockpit(page)
		// Open the drawer, pick the all-families sweep, then submit so the
		// mock streams `assessment.sweep.{started,progress,completed}`.
		await page.getByTestId('run-assessment-sweep-button').click()
		await page.getByTestId('assessment-family-all').click()
		await page.getByTestId('assessment-run-submit').click()
		// The Recent multi-family sweeps card surfaces the sweep summary.
		await expect(page.getByText('Multi-family sweep · sw-live-1')).toBeVisible()
		await expect(page.getByText(/completed · sequential/i)).toBeVisible()
	})

	test('cancelling a sweep transitions it to cancelled', async ({ page }) => {
		bridge = await bootCockpit(page, { holdSweepOpen: true })
		await page.getByTestId('run-assessment-sweep-button').click()
		await page.getByTestId('assessment-family-all').click()
		await page.getByTestId('assessment-run-submit').click()
		const cancelBtn = page.getByTestId('assessment-sweep-cancel-button').first()
		await expect(cancelBtn).toBeVisible()
		await cancelBtn.click()
		await expect(page.getByText('cancelled', { exact: false })).toBeVisible()
	})

	test('list_runs failure shows banner + retry', async ({ page }) => {
		bridge = await bootCockpit(page, {
			failures: [
				{
					action: 'list_runs',
					code: 'persistence.disabled',
					message: 'session persistence is not configured',
				},
			],
		})
		const banner = page.getByTestId('assessment-query-error-banner')
		await expect(banner).toBeVisible()
		await expect(banner.getByText('Backend unavailable')).toBeVisible()
		const retry = page.getByTestId('assessment-query-error-retry').first()
		await expect(retry).toBeVisible()
		await retry.click()
		// Banner stays because the mock keeps returning the failure for the
		// configured action; retry simply re-issues the request.
		await expect(banner.getByText('Backend unavailable')).toBeVisible()
	})

	test('query_failed event surfaces in the failure stack', async ({ page }) => {
		bridge = await bootCockpit(page, {
			postHandshakeEvents: [
				{
					type: 'assessment.query_failed',
					payload: {
						action: 'list_runs',
						code: 'assessment.query_failed',
						message: 'event log truncated',
					},
				},
			],
		})
		const banner = page.getByTestId('assessment-query-error-banner')
		await expect(banner).toBeVisible()
		await expect(banner.getByText('Event log unavailable')).toBeVisible()
	})

	test('worker_output_rejected events surface as warnings', async ({ page }) => {
		bridge = await bootCockpit(page, {
			postHandshakeEvents: [
				{
					type: 'assessment.worker_output_rejected',
					payload: {
						run_id: 'run-001',
						code: 'schema_version_unsupported',
						message: 'unsupported worker output schema_version 99',
						path: 'schema_version',
					},
				},
			],
		})
		// Worker-output rejection banners only render inside the run report
		// detail view (keyed by run_id). Open the report for `run-001` so the
		// AssessmentReportDetail surface can mount the rejection alert.
		await page.getByRole('button', { name: 'View report for run run-001' }).click()
		await expect(page.getByText('Worker output rejected', { exact: false })).toBeVisible()
	})
})
