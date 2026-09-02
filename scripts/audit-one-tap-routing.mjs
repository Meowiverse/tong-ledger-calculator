import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'

const SETTINGS_KEY = 'tong-ledger-settings-v1'
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
    output: '',
    localDatePreflight: false,
    localDatePreflightPort: 8787,
    port: 4176,
    timeoutMs: 20_000,
  }

  for (const arg of argv) {
    if (arg.startsWith('--base-url=')) args.baseUrl = arg.slice('--base-url='.length)
    if (arg.startsWith('--dir=')) args.dir = path.resolve(arg.slice('--dir='.length))
    if (arg.startsWith('--manifest=')) args.manifest = path.resolve(arg.slice('--manifest='.length))
    if (arg.startsWith('--output=')) args.output = path.resolve(arg.slice('--output='.length))
    if (arg === '--local-date-preflight') args.localDatePreflight = true
    if (arg.startsWith('--local-date-preflight-port=')) {
      args.localDatePreflightPort = Number(arg.slice('--local-date-preflight-port='.length)) || args.localDatePreflightPort
    }
    if (arg.startsWith('--port=')) args.port = Number(arg.slice('--port='.length)) || args.port
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

function loadManifest(manifestPath) {
  if (!manifestPath) return null
  const raw = fs.readFileSync(manifestPath, 'utf8')
  const parsed = JSON.parse(raw)
  const images = Array.isArray(parsed.images) ? parsed.images : []
  return new Map(images.map((item) => [path.basename(item.path || item.file || ''), item]))
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

function startDatePreflightServer(port) {
  const child = spawn('node', ['scripts/local-date-preflight-server.mjs', `--port=${port}`], {
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

async function waitForServer(url, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`等待本地预览超时: ${url}`)
}

function ensureOutputPath(outputPath) {
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    return outputPath
  }
  const fallback = path.resolve('reports', 'gridcut-benchmark', `one-tap-routing-${nowStamp()}.json`)
  fs.mkdirSync(path.dirname(fallback), { recursive: true })
  return fallback
}

async function configureMockLocal(page, args) {
  await page.evaluate((config) => {
    const settingsKey = config.settingsKey
    const settings = JSON.parse(localStorage.getItem(settingsKey) || '{}')
    localStorage.setItem(
      settingsKey,
      JSON.stringify({
        ...settings,
        apiKey: '',
        apiMode: 'mockLocal',
        model: 'mock-local-max',
        qualityMode: 'max',
        localDatePreflightEnabled: Boolean(config.localDatePreflight),
        localDatePreflightUrl: `http://127.0.0.1:${config.localDatePreflightPort}/date-preflight`,
        priorityCropOcrEnabled: true,
        priorityCropOcrLimit: 8,
      }),
    )
  }, {
    settingsKey: SETTINGS_KEY,
    localDatePreflight: args.localDatePreflight,
    localDatePreflightPort: args.localDatePreflightPort,
  })
}

async function waitForRoute(page, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const raw = await page.evaluate((storageKey) => localStorage.getItem(storageKey), LAST_RESULT_KEY)
    if (raw) {
      const result = JSON.parse(raw)
      const sourceType = String(result?.sourceType || '')
      if (sourceType.includes('本地预览')) {
        return {
          route: 'hold',
          result,
        }
      }
      if (sourceType) {
        return {
          route: 'model',
          result,
        }
      }
    }
    await page.waitForTimeout(200)
  }
  throw new Error('等待一键路线结果超时')
}

function expectedRoute(manifestRow) {
  if (!manifestRow) return null
  return manifestRow?.bucket === 'complete-page-candidate' ? 'model' : 'hold'
}

function summarize(results) {
  const byBucket = {}
  for (const item of results) {
    const bucket = item.bucket || 'unknown'
    byBucket[bucket] ??= { total: 0, matched: 0 }
    byBucket[bucket].total += 1
    if (item.ok) byBucket[bucket].matched += 1
  }
  const scored = results.filter((item) => item.expectedRoute)
  return {
    total: results.length,
    scored: scored.length,
    matched: scored.filter((item) => item.ok).length,
    mismatched: scored.filter((item) => !item.ok).length,
    unscored: results.length - scored.length,
    byBucket,
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  const images = listImages(args.dir)
  if (!images.length) throw new Error(`目录里没有可用图片: ${args.dir}`)
  const manifest = loadManifest(args.manifest)

  let previewServer = null
  let datePreflightServer = null
  const baseUrl = args.baseUrl || `http://127.0.0.1:${args.port}`
  const datePreflightUrl = `http://127.0.0.1:${args.localDatePreflightPort}/health`
  if (args.localDatePreflight) {
    datePreflightServer = startDatePreflightServer(args.localDatePreflightPort)
    try {
      await waitForServer(datePreflightUrl, args.timeoutMs)
    } catch (error) {
      datePreflightServer.child.kill('SIGTERM')
      throw new Error(`${error instanceof Error ? error.message : '开发日期预审 helper 启动失败'}\n${datePreflightServer.getLogs()}`)
    }
  }
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
  const results = []

  try {
    for (const imagePath of images) {
      const image = path.basename(imagePath)
      const manifestRow = manifest?.get(image) || null
      await page.goto(`${baseUrl}/?lab=1`)
      await page.evaluate(() => localStorage.clear())
      await configureMockLocal(page, args)
      await page.goto(`${baseUrl}/?lab=1`)
      const fileInput = page.locator('input[type="file"]').first()
      await fileInput.waitFor({ state: 'attached', timeout: args.timeoutMs })
      await fileInput.setInputFiles(imagePath)
      await page.getByRole('heading', { name: /照片已准备好/ }).waitFor({ timeout: args.timeoutMs })
      await page.getByRole('button', { name: '开始计算' }).click()
      const { route, result } = await waitForRoute(page, args.timeoutMs)
      const expected = expectedRoute(manifestRow)
      results.push({
        image,
        bucket: manifestRow?.bucket || 'unknown',
        localOcrDateCount: manifestRow?.localOcrDateCount ?? null,
        localOcrDateRange: manifestRow?.localOcrDateRange ?? null,
        localOcrDatesMissing: manifestRow?.localOcrDatesMissing ?? [],
        expectedRoute: expected,
        actualRoute: route,
        sourceType: result.sourceType || null,
        cropStatus: result.cropOcrExecution?.status || null,
        sentCropCount: result.cropOcrExecution?.sentCropCount || 0,
        gridCutLevel: result.gridCut?.level || null,
        gridCutScore: result.gridCut?.score ?? null,
        gridCutConfidence: result.gridCut?.confidence ?? null,
        ok: expected ? route === expected : true,
      })
    }
  } finally {
    await browser.close()
    if (previewServer) previewServer.child.kill('SIGTERM')
    if (datePreflightServer) datePreflightServer.child.kill('SIGTERM')
  }

  const report = {
    summary: summarize(results),
    results,
  }
  const outputPath = ensureOutputPath(args.output)
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ outputPath, summary: report.summary }, null, 2))
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : 'one-tap routing audit failed')
  process.exit(1)
})
