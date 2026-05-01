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
		await expect(
			page.getByText('TLS missing on staging endpoint', { exact: false }),
		).toBeVisible()
		await expect(
			page.getByText('All RTD checks green', { exact: false }),
		).toBeVisible()
	})

	test('selecting a run loads its findings', async ({ page }) => {
		bridge = await bootCockpit(page)
		await page.getByText('TLS missing on staging endpoint', { exact: false }).click()
		await expect(page.getByText('warn', { exact: false })).toBeVisible()
		await expect(page.getByText('security', { exact: false })).toBeVisible()
	})

	test('running a single-family assessment shows live progress', async ({ page }) => {
		bridge = await bootCockpit(page)
		await page.getByTestId('run-assessment-button').click()
		await expect(page.getByText(/discovery|pass 1\/2/i)).toBeVisible()
		await expect(page.getByText('Mock finding from live run', { exact: false })).toBeVisible()
		await expect(page.getByText(/completed|pass 2\/2/i)).toBeVisible()
	})

	test('sweep run streams progress per family', async ({ page }) => {
		bridge = await bootCockpit(page)
		await page.getByTestId('run-assessment-sweep-button').click()
		await expect(page.getByText(/rtd[\s\S]*security|security[\s\S]*rtd/i)).toBeVisible()
		await expect(page.getByText(/2\s*\/\s*2|completed/i)).toBeVisible()
	})

	test('cancelling a sweep transitions it to cancelled', async ({ page }) => {
		bridge = await bootCockpit(page)
		await page.getByTestId('run-assessment-sweep-button').click()
		const cancelBtn = page.getByTestId('assessment-sweep-cancel-button').first()
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
		await expect(page.getByText(/persistence|backend unavailable/i)).toBeVisible()
		const retry = page.getByTestId('assessment-query-error-retry').first()
		await expect(retry).toBeVisible()
		await retry.click()
		// Banner stays because the mock keeps returning the failure for the
		// configured action; retry simply re-issues the request.
		await expect(page.getByText(/persistence|backend unavailable/i)).toBeVisible()
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
		await expect(page.getByText(/event log|query failed/i)).toBeVisible()
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
		await page.getByText('All RTD checks green', { exact: false }).click()
		await expect(page.getByText(/schema_version_unsupported|worker output/i)).toBeVisible()
	})
})
