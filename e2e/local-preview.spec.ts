import { expect, test } from '@playwright/test'
import path from 'node:path'

const sampleImages = [
  'handwritten-ledger.png',
  'handwritten-ledger-phone.png',
  'handwritten-ledger-rescan.png',
]

for (const sampleImageName of sampleImages) {
  test(`mobile local cutting preview keeps evidence and blocks S for ${sampleImageName}`, async ({ page }) => {
    await page.goto('/?lab=1')

    const sampleImage = path.resolve('public/samples', sampleImageName)
    await page.locator('input[type="file"]').first().setInputFiles(sampleImage)
    await expect(page.getByRole('heading', { name: '照片已准备好' })).toBeVisible()

    await page.getByRole('button', { name: '本地切割预览' }).click()

    await expect(page.getByRole('region', { name: '重绘表格对照' })).toBeVisible()
    await expect(page.getByLabel('原图固定格子切割对照')).toBeVisible()
    await expect(page.getByLabel('当前格子裁剪', { exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText('系统不会把它当成可靠切割')
    await expect(page.getByRole('button', { name: /纸类1 空白/ })).toBeVisible()
    const scorePanel = page.getByRole('region', { name: 'UX 评分子 AI' })
    await scorePanel.scrollIntoViewIfNeeded()
    await expect(scorePanel.getByText('B 级')).toBeVisible()
    await expect(scorePanel.getByText('82/100')).toBeVisible()
    await expect(scorePanel.getByText('本地预览已带格子证据；切割状态：需先校准，必须先校准')).toBeVisible()
  })
}
