import { expect, test } from '@playwright/test'
import path from 'node:path'

test('local mock mode runs max pipeline without API key or external network', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/')
  await page.getByRole('button', { name: '打开设置' }).click()
  await page.getByText('纸张与接口设置').click()
  await page.getByLabel('接口格式').selectOption('mockLocal')
  await page.getByLabel('识别档位').selectOption('max')
  await page.getByLabel('小图 OCR 上限').fill('2')

  await expect(page.getByText('本地 mock 识别')).toBeVisible()
  await expect(page.getByLabel('API Key')).toBeDisabled()
  await expect(page.getByLabel('API 地址')).toBeDisabled()

  const sampleImage = path.resolve('public/samples', 'handwritten-ledger.png')
  await page.locator('input[type="file"]').first().setInputFiles(sampleImage)

  await expect(page.getByRole('region', { name: '识别前本地预检' })).toContainText('建议抽查')
  await page.getByRole('button', { name: '开始计算' }).click()

  const cropPanel = page.getByRole('region', { name: '小图 OCR 计划', exact: true })
  await expect(cropPanel).toBeVisible()
  await expect(cropPanel).toContainText('已追加复核 2 格，回收 2 条候选。')
  await expect(page.getByText('当前合计').first()).toBeVisible()

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tong-ledger-last-result-v5') || 'null'))
  expect(stored?.cropOcrExecution?.status).toBe('completed')
  expect(stored?.cropOcrExecution?.sentCropCount).toBe(2)
  expect(stored?.cropOcrExecution?.returnedTokenCount).toBe(2)
})

test('one tap can run local mock result after pending preflight finishes', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/')
  await page.getByRole('button', { name: '打开设置' }).click()
  await page.getByText('纸张与接口设置').click()
  await page.getByLabel('接口格式').selectOption('mockLocal')
  await page.getByLabel('识别档位').selectOption('max')

  const sampleImage = path.resolve('public/samples', 'handwritten-ledger.png')
  await page.locator('input[type="file"]').first().setInputFiles(sampleImage)
  await page.getByRole('button', { name: '开始计算' }).click()

  await expect(page.getByText('当前合计').first()).toBeVisible()

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tong-ledger-last-result-v5') || 'null'))
  expect(stored?.sourceType).toBeTruthy()
  expect(stored?.cropOcrExecution?.status).toBe('completed')
})
