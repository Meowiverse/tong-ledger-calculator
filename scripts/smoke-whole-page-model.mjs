import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-5.4'
const DEFAULT_IMAGE =
  '/Users/kongjing/Downloads/1e54d27dad3fbca7d52c62b825ef3a71.jpg'

function readArg(name, fallback = '') {
  const prefix = `--${name}=`
  const found = process.argv.find((arg) => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : fallback
}

function nowStamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  return 'image/jpeg'
}

function imageToDataUrl(filePath) {
  const buffer = fs.readFileSync(filePath)
  return `data:${mimeFor(filePath)};base64,${buffer.toString('base64')}`
}

function parseJsonObject(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('model response was not JSON')
    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

function buildPrompt() {
  return [
    '你是 tong账本 的单次整页识别评测引擎。',
    '只根据这一张完整账本照片输出 JSON；不要根据任何预期总额倒推。',
    '先确认是否完整包含表头、日期列和 1日至31日；不完整则 confidence 不得高于 0.55。',
    '固定列为：日期、上班、纸类1、纸类2、纸类3、纸类4、上下货、扣款、日合计。',
    '表头第一行小数是纸类单价/倍率；纸类列按 rawValue * multiplier 计入；上下货按直接金额；扣款为负向调整。',
    '红色手工计算式、下划线和合计只能作为审计证据，不要把红字合计当成普通格子重复入账。',
    '输出所有参与计算的 entries。每项必须包含 day、column、rawText、rawValue、multiplier、calculatedAmount、confidence、note。',
    '最后返回 computedTotal、overallConfidence、isCompletePage、dateCount、redCalculationNotes、uncertain、auditNotes。',
    '只返回 JSON 对象，不要 Markdown。',
  ].join('\n')
}

async function main() {
  const imagePath = path.resolve(readArg('image', DEFAULT_IMAGE))
  const model = readArg('model', process.env.WHOLE_PAGE_MODEL || process.env.VISION_MODEL || DEFAULT_MODEL)
  const baseUrl = readArg(
    'base-url',
    process.env.OPENAI_BASE_URL || process.env.AUTOROUTER_BASE_URL || process.env.VISION_API_BASE_URL || DEFAULT_BASE_URL,
  ).replace(/\/+$/g, '')
  const apiKey = process.env.OPENAI_API_KEY || process.env.AUTOROUTER_API_KEY || process.env.VISION_API_KEY
  const outputDir = path.resolve(readArg('output-dir', 'reports/model-smoke'))

  if (!fs.existsSync(imagePath)) throw new Error(`Image not found: ${imagePath}`)
  if (!apiKey) {
    console.error('No API key found. Set OPENAI_API_KEY, AUTOROUTER_API_KEY, or VISION_API_KEY to run one real whole-page call.')
    process.exit(2)
  }

  const startedAt = Date.now()
  const response = await fetch(`${baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt() },
            { type: 'image_url', image_url: { url: imageToDataUrl(imagePath), detail: 'high' } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  })

  const rawBody = await response.text()
  if (!response.ok) throw new Error(rawBody || `request failed: ${response.status}`)
  const payload = JSON.parse(rawBody)
  const result = parseJsonObject(payload?.choices?.[0]?.message?.content || '')
  const report = {
    generatedAt: new Date().toISOString(),
    imagePath,
    model,
    baseUrl,
    elapsedMs: Date.now() - startedAt,
    usage: payload.usage ?? null,
    result,
  }

  fs.mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, `whole-page-${nowStamp()}-${model.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`)
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    outputPath,
    model,
    elapsedMs: report.elapsedMs,
    usage: report.usage,
    computedTotal: result.computedTotal ?? null,
    overallConfidence: result.overallConfidence ?? null,
    entryCount: Array.isArray(result.entries) ? result.entries.length : null,
    dateCount: result.dateCount ?? null,
    isCompletePage: result.isCompletePage ?? null,
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'whole-page model smoke failed')
  process.exit(1)
})
