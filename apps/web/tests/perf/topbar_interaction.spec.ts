import { test, expect, Page } from '@playwright/test'
import * as fs from 'node:fs'
import { MockBridge } from '../e2e/mock-bridge'

/**
 * F2.5 perf driver — measures click → settings-overlay-visible latency for
 * the topbar Settings button. Paired with `tools/perf/src/scenarios/
 * topbar_interaction.rs`, which spawns this spec via `pnpm -F web exec
 * playwright test --project=perf` and reads the JSON payload written to the
 * path passed via `VAC_PERF_OUTPUT`.
 *
 * Methodology:
 *   1. Boot the production cockpit bundle (vite preview, port 4173) wired to
 *      a deterministic `MockBridge` so handshake + session/new succeed
 *      without a live local-bridge.
 *   2. Run `WARMUP_ITERATIONS` discarded iterations (cold render, allocator
 *      warmup, vite preview JIT).
 *   3. Run `TIMED_SAMPLES` iterations, each bracketing in-page
 *      `performance.now()` around `button.click()` → `requestAnimationFrame`
 *      poll until `[data-testid="settings-overlay"]` is computed-visible.
 *   4. Emit `{subsystem, samples_ms}` so the Rust driver can convert ms→ns
 *      and reuse the shared `summarize()` helper for p50/p95/p99.
 *
 * Budget: `topbar_interaction_p95_ms = 100` (config/slo-budgets.yaml).
 */

const SUBSYSTEM = 'topbar_interaction'
const WARMUP_ITERATIONS = 5
const TIMED_SAMPLES = 50

declare global {
	interface Window {
		__vacBridgeOverride?: string
	}
}

async function bootCockpit(page: Page): Promise<MockBridge> {
	const bridge = new MockBridge({})
	const url = await bridge.start()
	await page.addInitScript((wsUrl: string) => {
		window.__vacBridgeOverride = wsUrl
		window.localStorage.setItem('vac_web_access_token', 'playwright-token')
	}, url)
	await page.goto('/')
	await expect(page.locator('header.topbar')).toBeVisible()
	return bridge
}

/**
 * Bracket-times one click → overlay-visible cycle from the page side so the
 * cross-context Playwright RPC overhead does not pollute the measurement.
 * Returns the latency in milliseconds (browser `performance.now()` delta).
 */
async function measureClickToOverlayMs(page: Page): Promise<number> {
	return page.evaluate(() => {
		return new Promise<number>((resolve, reject) => {
			const button = document.querySelector(
				'[data-testid="topbar-settings-button"]',
			) as HTMLButtonElement | null
			if (!button) {
				reject(new Error('topbar-settings-button not present'))
				return
			}
			const t0 = performance.now()
			button.click()
			const deadline = t0 + 5000
			const tick = () => {
				const overlay = document.querySelector(
					'[data-testid="settings-overlay"]',
				) as HTMLElement | null
				if (
					overlay &&
					overlay.offsetParent !== null &&
					getComputedStyle(overlay).display !== 'none'
				) {
					resolve(performance.now() - t0)
					return
				}
				if (performance.now() > deadline) {
					reject(new Error('settings-overlay not visible within 5s'))
					return
				}
				requestAnimationFrame(tick)
			}
			requestAnimationFrame(tick)
		})
	})
}

test.describe('topbar_interaction perf driver', () => {
	test('measures click to settings-overlay-visible latency', async ({ page }) => {
		test.setTimeout(180_000)
		const bridge = await bootCockpit(page)
		try {
			const settingsButton = page.getByTestId('topbar-settings-button')
			const overlay = page.getByTestId('settings-overlay')
			const closeButton = page.getByTestId('settings-close')

			await expect(settingsButton).toBeVisible()
			await expect(settingsButton).toBeEnabled()

			const samplesMs: number[] = []
			const totalIterations = WARMUP_ITERATIONS + TIMED_SAMPLES
			for (let i = 0; i < totalIterations; i++) {
				const dt = await measureClickToOverlayMs(page)
				if (i >= WARMUP_ITERATIONS) {
					samplesMs.push(dt)
				}
				await closeButton.click()
				await expect(overlay).toBeHidden()
			}

			expect(samplesMs.length).toBe(TIMED_SAMPLES)

			const payload = { subsystem: SUBSYSTEM, samples_ms: samplesMs }
			const outputPath = process.env.VAC_PERF_OUTPUT
			if (outputPath) {
				fs.writeFileSync(outputPath, JSON.stringify(payload) + '\n')
			} else {
				// eslint-disable-next-line no-console
				console.log(JSON.stringify(payload))
			}
		} finally {
			await bridge.stop()
		}
	})
})
