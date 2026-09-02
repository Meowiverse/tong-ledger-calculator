import { expect, test } from '@playwright/test'
import path from 'node:path'
import { buildMockCalculationProgram, buildMockRecognition, buildMockVisualExtraction } from './mockLedgerFixtures'

function mockChatCompletionPayload(content: unknown) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(content),
        },
      },
    ],
  }
}

function requestContent(body: unknown) {
  const messages = typeof body === 'object' && body !== null
    ? (body as { messages?: unknown }).messages
    : null
  const firstMessage = Array.isArray(messages) ? messages[0] : null
  return typeof firstMessage === 'object' && firstMessage !== null
    ? (firstMessage as { content?: unknown }).content
    : null
}

function isTextPart(part: unknown): part is { type: 'text'; text: string } {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { type?: unknown }).type === 'text' &&
    typeof (part as { text?: unknown }).text === 'string'
  )
}

function requestText(body: unknown) {
  const content = requestContent(body)
  if (!Array.isArray(content)) return ''
  return content
    .filter(isTextPart)
    .map((part) => part.text)
    .join('\n')
}

function cropRefsFromBody(body: unknown) {
  const content = requestContent(body)
  if (!Array.isArray(content)) return []
  return content
    .filter(isTextPart)
    .flatMap((part) => {
      const match = part.text.match(/裁剪 \d+:\s*([^\s/]+)/)
      return match ? [match[1]] : []
    })
}

function imageUrlsFromBody(body: unknown) {
  const content = requestContent(body)
  if (!Array.isArray(content)) return []
  return content.flatMap((part) => {
    if (
      typeof part === 'object' &&
      part !== null &&
      (part as { type?: unknown }).type === 'image_url'
    ) {
      const imageUrl = (part as { image_url?: { url?: unknown } }).image_url?.url
      return typeof imageUrl === 'string' ? [imageUrl] : []
    }
    return []
  })
}

test('max mode can finish full mock OCR loop without spending real tokens', async ({ page }) => {
  const callCounts = {
    visual: 0,
    program: 0,
    audit: 0,
    reconcile: 0,
    crop: 0,
  }
  const imagePayloads: string[][] = []

  await page.route('**/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON()
    const text = requestText(body)

    if (text.includes('视觉定位引擎')) {
      callCounts.visual += 1
      imagePayloads.push(imageUrlsFromBody(body))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockChatCompletionPayload(buildMockVisualExtraction())),
      })
      return
    }

    if (text.includes('计算程序生成器')) {
      callCounts.program += 1
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockChatCompletionPayload(buildMockCalculationProgram())),
      })
      return
    }

    if (text.includes('第二阶段审计引擎')) {
      callCounts.audit += 1
      imagePayloads.push(imageUrlsFromBody(body))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockChatCompletionPayload(buildMockRecognition('audit'))),
      })
      return
    }

    if (text.includes('最终一致性复核引擎')) {
      callCounts.reconcile += 1
      imagePayloads.push(imageUrlsFromBody(body))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockChatCompletionPayload(buildMockRecognition('reconcile'))),
      })
      return
    }

    if (text.includes('单格裁剪图')) {
      callCounts.crop += 1
      const cropRefs = cropRefsFromBody(body).slice(0, 2)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          mockChatCompletionPayload({
            readings: cropRefs.map((cropRef, index) => ({
              cropRef,
              text: index === 0 ? '570' : '1720',
              confidence: 0.81,
              kind: 'number',
            })),
            auditNotes: ['mock crop ocr'],
          }),
        ),
      })
      return
    }

    await route.fulfill({
      status: 500,
      contentType: 'text/plain',
      body: `Unhandled mock request:\n${text}`,
    })
  })

  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/')
  await page.getByRole('button', { name: '打开设置' }).click()
  await page.getByLabel('API Key').fill('sk-mock')
  await page.getByLabel('模型名').fill('gpt-4o-mock')
  await page.getByLabel('识别档位').selectOption('max')
  await page.getByLabel('小图 OCR 上限').fill('2')

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

  expect(callCounts).toEqual({
    visual: 1,
    program: 1,
    audit: 1,
    reconcile: 1,
    crop: 1,
  })
  expect(imagePayloads).toHaveLength(3)
  for (const payload of imagePayloads) {
    expect(payload).toHaveLength(2)
    expect(payload.every((imageUrl) => imageUrl.startsWith('data:image/webp'))).toBe(true)
    expect(payload.every((imageUrl) => imageUrl.length < 1_200_000)).toBe(true)
  }
})

test('slow model request shows one-button progress without spending real tokens', async ({ page }) => {
  let releaseVisualRequest!: () => void
  const visualRequestCanFinish = new Promise<void>((resolve) => {
    releaseVisualRequest = resolve
  })

  await page.route('**/v1/chat/completions', async (route) => {
    const body = route.request().postDataJSON()
    const text = requestText(body)

    if (text.includes('视觉定位引擎')) {
      await visualRequestCanFinish
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockChatCompletionPayload(buildMockVisualExtraction())),
      })
      return
    }

    if (text.includes('计算程序生成器')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockChatCompletionPayload(buildMockCalculationProgram())),
      })
      return
    }

    if (text.includes('第二阶段审计引擎')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockChatCompletionPayload(buildMockRecognition('audit'))),
      })
      return
    }

    if (text.includes('最终一致性复核引擎')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockChatCompletionPayload(buildMockRecognition('reconcile'))),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(mockChatCompletionPayload({ readings: [] })),
    })
  })

  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/')
  await page.getByRole('button', { name: '打开设置' }).click()
  await page.getByLabel('API Key').fill('sk-mock')
  await page.getByLabel('模型名').fill('gpt-4o-mock')
  await page.getByLabel('识别档位').selectOption('max')

  const sampleImage = path.resolve('public/samples', 'handwritten-ledger.png')
  await page.locator('input[type="file"]').first().setInputFiles(sampleImage)
  await page.getByRole('button', { name: '开始计算' }).click()

  await expect(page.getByRole('button', { name: '正在计算…' })).toBeDisabled()
  await expect(page.getByRole('status')).toContainText('正在请求服务器识别')
  await expect(page.getByRole('status')).toContainText(/\d+s/)

  releaseVisualRequest()
  await expect(page.getByText('当前合计').first()).toBeVisible()
})
