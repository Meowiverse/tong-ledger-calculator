import { expect, test } from '@playwright/test'
import path from 'node:path'

const sampleImages = [
  'handwritten-ledger.png',
  'handwritten-ledger-phone.png',
  'handwritten-ledger-rescan.png',
]

for (const sampleImageName of sampleImages) {
  test(`mobile single-page cutting preview keeps evidence and blocks S for ${sampleImageName}`, async ({ page }) => {
    await page.goto('/?lab=1')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/?lab=1')

    const sampleImage = path.resolve('public/samples', sampleImageName)
    await page.locator('input[type="file"]').first().setInputFiles(sampleImage)
    await expect(page.getByRole('heading', { name: '整页照片已准备好' })).toBeVisible()

    await page.getByRole('button', { name: '单页切割预览' }).click()

    await expect(page.getByRole('region', { name: '重绘表格对照' })).toBeVisible()
    await expect(page.getByText('217 处待确认，修改后自动重算。')).toBeVisible()
    await expect(page.getByLabel('原图固定格子切割对照')).toBeVisible()
    await expect(page.getByLabel('当前格子裁剪', { exact: true })).toBeVisible()
    await expect(page.getByLabel('当前格切格证据')).toContainText('当前格切格')
    await expect(page.getByRole('alert')).toContainText('系统不会把它当成可靠切割')
    await expect(page.getByRole('button', { name: /纸类1 空白/ })).toBeVisible()
    const scorePanel = page.getByRole('region', { name: 'UX 评分子 AI' })
    await scorePanel.scrollIntoViewIfNeeded()
    await expect(scorePanel.getByText('B 级')).toBeVisible()
    await expect(scorePanel.getByText('82/100')).toBeVisible()
    await expect(scorePanel.getByText('本地预览已带格子证据；切割状态：建议抽查，重点抽查低置信格')).toBeVisible()
  })
}

test('loaded sample keeps local grid-cut evidence in the main recognition flow', async ({ page }) => {
  await page.goto('/?lab=1')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/?lab=1')

  await page.getByRole('button', { name: '加载测试案例' }).click()

  await expect(page.getByLabel('自动切割可行度')).toContainText('本地 CNN + 格线融合')
  await expect(page.getByLabel('当前格切格证据')).toContainText('当前格切格')
  await expect(page.getByRole('region', { name: '重绘表格对照' })).toContainText('本地 CNN + 格线融合')
  const cropPlan = page.getByRole('region', { name: '小图 OCR 计划', exact: true })
  await expect(cropPlan).toBeVisible()
  await expect(cropPlan).toContainText(/整页 1 张 \+ 建议小图/)
})
