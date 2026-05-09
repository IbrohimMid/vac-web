import { test, expect, Page } from '@playwright/test'
import { MockBridge, MockBridgeOptions } from './mock-bridge'

declare global {
	interface Window {
		__vacBridgeOverride?: string
	}
}

async function bootTopbar(
	page: Page,
	bridgeOpts: MockBridgeOptions = {},
): Promise<MockBridge> {
	const bridge = new MockBridge(bridgeOpts)
	const url = await bridge.start()
	await page.addInitScript((wsUrl: string) => {
		window.__vacBridgeOverride = wsUrl
		window.localStorage.setItem('vac_web_access_token', 'playwright-token')
	}, url)
	await page.goto('/')
	await expect(page.locator('header.topbar')).toBeVisible()
	return bridge
}

test.describe('topbar interactions', () => {
	let bridge: MockBridge | null = null

	test.afterEach(async () => {
		if (bridge) {
			await bridge.stop()
			bridge = null
		}
	})

	test('opens command palette from search trigger and keyboard shortcut', async ({ page }) => {
		bridge = await bootTopbar(page)
		const search = page.getByRole('button', { name: 'Search' })
		await expect(search).toBeVisible()
		await expect(search).toHaveAttribute('data-affordance-id', 'topbar.search.trigger')

		await search.click()
		await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
		await expect(page.getByPlaceholder(/Type a command, page, or assessment/)).toBeFocused()

		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
		await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden()
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K')
		await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
	})

	test('exposes accessible topbar controls and toggles theme without moving focus', async ({ page }) => {
		bridge = await bootTopbar(page)
		const theme = page.getByRole('button', { name: 'Toggle theme' })
		const notifications = page.getByRole('button', { name: 'Notifications' })
		const settings = page.getByTestId('topbar-settings-button')
		const tweaks = page.getByRole('button', { name: 'Tweaks' })

		await expect(theme).toBeVisible()
		await expect(notifications).toBeVisible()
		await expect(settings).toHaveAttribute('aria-label', 'Settings')
		await expect(tweaks).toBeVisible()
		await expect(page.getByTestId('perf-badge')).toHaveAttribute('role', 'status')

		await theme.focus()
		await page.keyboard.press('Enter')
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
		await expect(theme).toBeFocused()

		await page.keyboard.press('Enter')
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
	})

	test('supports keyboard activation on gate pills', async ({ page }) => {
		bridge = await bootTopbar(page, {
			connectEvents: [
				{
					type: 'gate.changed',
					payload: {
						id: 'DevComplete',
						state: 'open',
						summary: 'Needs final review',
					},
				},
			],
		})
		const gate = page.getByRole('button', { name: 'DevComplete' })
		await expect(gate).toBeVisible()
		await expect(gate).toHaveAttribute('aria-pressed', 'false')
		await gate.focus()
		await page.keyboard.press('Enter')
		await expect(gate).toHaveAttribute('aria-pressed', 'true')
		await page.keyboard.press(' ')
		await expect(gate).toHaveAttribute('aria-pressed', 'false')
	})
})
