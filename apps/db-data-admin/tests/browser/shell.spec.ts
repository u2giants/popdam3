import { expect, test } from '@playwright/test'

test('renders the guarded shell without preview configuration', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /canonical data/i })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Preview configuration is missing')
  await expect(page.locator('meta[name="build-sha"]')).toHaveAttribute('content', /.+/)
})
