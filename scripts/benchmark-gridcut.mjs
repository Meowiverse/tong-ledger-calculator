import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'

const LAST_RESULT_KEY = 'tong-ledger-last-result-v5'
const DEFAULT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

function nowStamp() {
  const date = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

function parseArgs(argv) {
  const args = {
    baseUrl: '',
    dir: path.resolve('public/samples'),
    manifest: '',
    port: 4175,
    output: '',
    timeoutMs: 15_000,
  }

  for (const arg of argv) {
    if (arg.startsWith('--base-url=')) args.baseUrl = arg.slice('--base-url='.length)
    if (arg.startsWith('--dir=')) args.dir = path.resolve(arg.slice('--dir='.length))
    if (arg.startsWith('--manifest=')) args.manifest = path.resolve(arg.slice('--manifest='.length))
    if (arg.startsWith('--port=')) args.port = Number(arg.slice('--port='.length)) || args.port
    if (arg.startsWith('--output=')) args.output = path.resolve(arg.slice('--output='.length))
    if (arg.startsWith('--timeout-ms=')) args.timeoutMs = Number(arg.slice('--timeout-ms='.length)) || args.timeoutMs
  }

  return args
}

function listImages(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter((filePath) => DEFAULT_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .sort((left, right) => left.localeCompare(right))
}

async function waitForServer(url, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' })
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`等待本地预览超时: ${url}`)
}

function startPreviewServer(port) {
  const child = spawn('pnpm', ['preview', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  })

  let logs = ''
  child.stdout.on('data', (chunk) => {
    logs += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    logs += chunk.toString()
  })

  return {
    child,
    getLogs() {
      return logs.slice(-4000)
    },
  }
}

async function waitForGridCutResult(page, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const raw = await page.evaluate((storageKey) => localStorage.getItem(storageKey), LAST_RESULT_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.cells?.length) return parsed
    }
    await page.waitForTimeout(200)
  }
  throw new Error('等待本地切格结果超时')
}

function summarizeResult(imagePath, result) {
  const cells = Array.isArray(result.cells) ? result.cells : []
  const reviewable = cells.filter((cell) => cell.columnKind !== 'date' && cell.columnKind !== 'dailyTotal')
  const ocrCritical = reviewable.filter((cell) => cell.columnKind !== 'attendance')
  const lowCutCount = reviewable.filter((cell) => cell.riskFlags?.includes('cutLowConfidence')).length
  const ocrCriticalLowCutCount = ocrCritical.filter((cell) => cell.riskFlags?.includes('cutLowConfidence')).length
  const cutLevels = reviewable.reduce(
    (accumulator, cell) => {
      const level = cell.cutEvidence?.level || 'review'
      accumulator[level] = (accumulator[level] || 0) + 1
      return accumulator
    },
    { good: 0, review: 0, calibrate: 0 },
  )
  const meanCutConfidence =
    reviewable.length > 0
      ? Math.round(
          (reviewable.reduce((total, cell) => total + (cell.cutEvidence?.confidence || 0), 0) / reviewable.length) * 100,
        ) / 100
      : 0

  return {
    image: path.basename(imagePath),
    imagePath,
    method: result.gridCut?.method || 'template',
    level: result.gridCut?.level || 'calibrate',
    score: result.gridCut?.score ?? 0,
    confidence: result.gridCut?.confidence ?? 0,
    fallbackX: Boolean(result.gridCut?.fallback?.x),
    fallbackY: Boolean(result.gridCut?.fallback?.y),
    detectedHorizontal: result.gridCut?.support?.detectedHorizontal ?? 0,
    expectedHorizontal: result.gridCut?.support?.expectedHorizontal ?? 0,
    detectedVertical: result.gridCut?.support?.detectedVertical ?? 0,
    expectedVertical: result.gridCut?.support?.expectedVertical ?? 0,
    rawHorizontalSpan: result.gridCut?.support?.rawHorizontalSpan ?? 0,
    rawVerticalSpan: result.gridCut?.support?.rawVerticalSpan ?? 0,
    alignedHorizontalMatched: result.gridCut?.support?.alignedHorizontalMatched ?? 0,
    alignedHorizontalSynthetic: result.gridCut?.support?.alignedHorizontalSynthetic ?? 0,
    alignedVerticalMatched: result.gridCut?.support?.alignedVerticalMatched ?? 0,
    alignedVerticalSynthetic: result.gridCut?.support?.alignedVerticalSynthetic ?? 0,
    effectiveHorizontalCoverage: result.gridCut?.support?.effectiveHorizontalCoverage ?? 0,
    effectiveVerticalCoverage: result.gridCut?.support?.effectiveVerticalCoverage ?? 0,
    lowCutCellCount: lowCutCount,
    reviewableCellCount: reviewable.length,
    lowCutRatio: reviewable.length ? Math.round((lowCutCount / reviewable.length) * 1000) / 1000 : 0,
    ocrCriticalCellCount: ocrCritical.length,
    ocrCriticalLowCutCellCount: ocrCriticalLowCutCount,
    ocrCriticalLowCutRatio:
      ocrCritical.length ? Math.round((ocrCriticalLowCutCount / ocrCritical.length) * 1000) / 1000 : 0,
    meanCutConfidence,
    cutLevels,
    reasons: Array.isArray(result.gridCut?.reasons) ? result.gridCut.reasons.slice(0, 4) : [],
  }
}

function loadManifest(manifestPath) {
  if (!manifestPath) return null
  const raw = fs.readFileSync(manifestPath, 'utf8')
  const parsed = JSON.parse(raw)
  const images = Array.isArray(parsed.images) ? parsed.images : []
  const byName = new Map(images.map((item) => [path.basename(item.path || item.file || ''), item]))
  return {
    sourcePath: manifestPath,
    summary: parsed.summary || null,
    byName,
  }
}

function classifyDelivery(item, manifestRow) {
  const pageBucket = manifestRow?.bucket || 'unknown'
  const pageIncomplete = pageBucket === 'incomplete-or-cropped' || pageBucket === 'review-before-model'
  if (pageIncomplete) {
    return {
      pageBucket,
      modelGate: 'hold',
      reviewIntensity: 'manual-first',
      oneTapReady: false,
      reason: '整页不完整或日期缺失，先别进模型',
    }
  }

  const reviewRatio = item.reviewableCellCount
    ? (item.cutLevels.review || 0) / item.reviewableCellCount
    : 0
  const ocrCriticalReviewRatio = item.ocrCriticalCellCount
    ? (item.cutLevels.review || 0) / item.ocrCriticalCellCount
    : reviewRatio
  if (item.level === 'good' && item.lowCutRatio <= 0.03 && item.meanCutConfidence >= 0.72) {
    return {
      pageBucket,
      modelGate: 'send',
      reviewIntensity: 'light',
      oneTapReady: true,
      reason: '整页完整且本地格子稳定，可直接进模型',
    }
  }

  if (
    item.ocrCriticalLowCutRatio <= 0.26 &&
    ocrCriticalReviewRatio >= 0.7 &&
    item.meanCutConfidence >= 0.58
  ) {
    return {
      pageBucket,
      modelGate: 'send-with-review',
      reviewIntensity: item.ocrCriticalLowCutRatio > 0.12 ? 'strong' : 'normal',
      oneTapReady: false,
      reason: '整页完整，本地大多数格子已稳定，可进模型后重点抽查',
    }
  }

  return {
    pageBucket,
    modelGate: 'hold',
    reviewIntensity: 'manual-first',
    oneTapReady: false,
    reason: '本地切格后仍有太多不稳格子，先别消耗 OCR token。',
  }
}

function enrichItems(items, manifest) {
  return items.map((item) => {
    const manifestRow = manifest?.byName.get(item.image) || null
    const delivery = classifyDelivery(item, manifestRow)
    return {
      ...item,
      captureAudit: manifestRow
        ? {
            bucket: manifestRow.bucket,
            orientation: manifestRow.orientation,
            localOcrDateCount: manifestRow.localOcrDateCount,
            localOcrDateRange: manifestRow.localOcrDateRange,
          }
        : null,
      ...delivery,
    }
  })
}

function buildAggregate(items, sourceDir, manifest) {
  const totals = items.reduce(
    (accumulator, item) => {
      accumulator.score += item.score
      accumulator.confidence += item.confidence
      accumulator.lowCutCellCount += item.lowCutCellCount
      accumulator.reviewableCellCount += item.reviewableCellCount
      accumulator.levels[item.level] = (accumulator.levels[item.level] || 0) + 1
      accumulator.methods[item.method] = (accumulator.methods[item.method] || 0) + 1
      accumulator.modelGate[item.modelGate] = (accumulator.modelGate[item.modelGate] || 0) + 1
      accumulator.reviewIntensity[item.reviewIntensity] = (accumulator.reviewIntensity[item.reviewIntensity] || 0) + 1
      if (item.oneTapReady) accumulator.oneTapReadyCount += 1
      return accumulator
    },
    {
      score: 0,
      confidence: 0,
      lowCutCellCount: 0,
      reviewableCellCount: 0,
      levels: { good: 0, review: 0, calibrate: 0 },
      methods: {},
      modelGate: { hold: 0, 'send-with-review': 0, send: 0 },
      reviewIntensity: { 'manual-first': 0, normal: 0, strong: 0, light: 0 },
      oneTapReadyCount: 0,
    },
  )

  return {
    generatedAt: new Date().toISOString(),
    sourceDir,
    manifestPath: manifest?.sourcePath || null,
    imageCount: items.length,
    meanScore: items.length ? Math.round((totals.score / items.length) * 100) / 100 : 0,
    meanConfidence: items.length ? Math.round((totals.confidence / items.length) * 1000) / 1000 : 0,
    lowCutRatio:
      totals.reviewableCellCount > 0
        ? Math.round((totals.lowCutCellCount / totals.reviewableCellCount) * 1000) / 1000
        : 0,
    levelCounts: totals.levels,
    methodCounts: totals.methods,
    modelGateCounts: totals.modelGate,
    reviewIntensityCounts: totals.reviewIntensity,
    modelReadyRate:
      items.length ? Math.round(((totals.modelGate['send-with-review'] + totals.modelGate.send) / items.length) * 1000) / 1000 : 0,
    strictOneTapReadyRate:
      items.length ? Math.round((totals.oneTapReadyCount / items.length) * 1000) / 1000 : 0,
    worstImages: [...items]
      .sort((left, right) => left.score - right.score || right.lowCutRatio - left.lowCutRatio)
      .slice(0, 5)
      .map((item) => ({
        image: item.image,
        score: item.score,
        level: item.level,
        lowCutRatio: item.lowCutRatio,
        modelGate: item.modelGate,
      })),
    manifestSummary: manifest?.summary || null,
  }
}

function ensureOutputPath(requestedOutput) {
  if (requestedOutput) return requestedOutput
  const outputDir = path.resolve('reports/gridcut-benchmark')
  fs.mkdirSync(outputDir, { recursive: true })
  return path.join(outputDir, `gridcut-benchmark-${nowStamp()}.json`)
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  const images = listImages(args.dir)
  if (!images.length) throw new Error(`目录里没有可用图片: ${args.dir}`)
  const manifest = loadManifest(args.manifest)

  let previewServer = null
  const baseUrl = args.baseUrl || `http://127.0.0.1:${args.port}`
  if (!args.baseUrl) {
    previewServer = startPreviewServer(args.port)
    try {
      await waitForServer(baseUrl, args.timeoutMs)
    } catch (error) {
      previewServer.child.kill('SIGTERM')
      throw new Error(`${error instanceof Error ? error.message : '预览启动失败'}\n${previewServer.getLogs()}`)
    }
  }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 430, height: 960 } })
  const items = []

  try {
    for (const imagePath of images) {
      await page.goto(`${baseUrl}/?lab=1`)
      await page.evaluate(() => localStorage.clear())
      await page.goto(`${baseUrl}/?lab=1`)
      const fileInput = page.locator('input[type="file"]').first()
      await fileInput.waitFor({ state: 'attached', timeout: args.timeoutMs })
      await fileInput.setInputFiles(imagePath)
      await page.getByRole('heading', { name: '整页照片已准备好' }).waitFor({ timeout: args.timeoutMs })
      await page.getByRole('button', { name: '单页切割预览' }).click()
      await page.getByRole('region', { name: '重绘表格对照' }).waitFor({ timeout: args.timeoutMs })
      const result = await waitForGridCutResult(page, args.timeoutMs)
      items.push(summarizeResult(imagePath, result))
    }
  } finally {
    await browser.close()
    if (previewServer) previewServer.child.kill('SIGTERM')
  }

  const enrichedItems = enrichItems(items, manifest)
  const report = {
    aggregate: buildAggregate(enrichedItems, args.dir, manifest),
    items: enrichedItems,
  }
  const outputPath = ensureOutputPath(args.output)
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ outputPath, aggregate: report.aggregate }, null, 2))
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : 'grid cut benchmark failed')
  process.exit(1)
})
