import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = 8788
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_STATIC_DIR = path.resolve(__dirname, '..', 'dist')

const SESSION_COOKIE = 'tong_ledger_session'
const LOGIN_PATH = '/ledger/login'
const APP_BASE_PATH = '/ledger'

function readArg(name, fallback) {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : fallback
}

function jsonResponse(response, status, payload) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function textResponse(response, status, text, headers = {}) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers,
  })
  response.end(text)
}

function htmlResponse(response, status, html, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  response.end(html)
}

function redirectResponse(response, location) {
  response.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
  })
  response.end()
}

function readBody(request, limitBytes = 24 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limitBytes) {
        reject(new Error('Request body is too large.'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function parseJson(text) {
  const trimmed = String(text || '').trim()
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    return JSON.parse(unfenced)
  } catch {
    const start = unfenced.indexOf('{')
    const end = unfenced.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('Model response was not valid JSON.')
    return JSON.parse(unfenced.slice(start, end + 1))
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=')
        if (index < 0) return [part, '']
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
      }),
  )
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function authConfig() {
  const password = process.env.TONG_LEDGER_PASSWORD || process.env.LEDGER_PASSWORD || ''
  const secret = process.env.TONG_LEDGER_SECRET || process.env.LEDGER_SESSION_SECRET || password || 'dev-secret'
  return {
    enabled: Boolean(password),
    password,
    token: sha256(`tong-ledger:${secret}:${password}`),
  }
}

function serverListenConfig() {
  const addr = process.env.LEDGER_ADDR || ''
  if (addr.includes(':') && !process.env.PORT && !process.env.HOST) {
    const index = addr.lastIndexOf(':')
    return {
      host: addr.slice(0, index) || '127.0.0.1',
      port: Number(addr.slice(index + 1)) || DEFAULT_PORT,
    }
  }
  return {
    port: Number(readArg('port', process.env.PORT || DEFAULT_PORT)) || DEFAULT_PORT,
    host: readArg('host', process.env.HOST || '0.0.0.0'),
  }
}

function isAuthed(request) {
  const config = authConfig()
  if (!config.enabled) return true
  const cookies = parseCookies(request.headers.cookie || '')
  return safeEqual(cookies[SESSION_COOKIE] || '', config.token)
}

function loginHtml(error = '') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>tong账本登录</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f5f2; color: #1f2933; }
    main { width: min(360px, calc(100vw - 32px)); }
    form { display: grid; gap: 12px; }
    h1 { margin: 0 0 18px; font-size: 24px; letter-spacing: 0; }
    label { font-size: 14px; color: #52606d; }
    input { box-sizing: border-box; width: 100%; height: 44px; padding: 0 12px; border: 1px solid #cbd2d9; border-radius: 6px; background: white; font-size: 16px; }
    button { height: 44px; border: 0; border-radius: 6px; background: #1f2933; color: white; font-size: 15px; font-weight: 700; cursor: pointer; }
    p { min-height: 20px; margin: 4px 0 0; color: #b42318; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1>tong账本</h1>
    <form method="post" action="${LOGIN_PATH}">
      <label for="password">访问密码</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autofocus />
      <button type="submit">进入</button>
      <p>${error}</p>
    </form>
  </main>
</body>
</html>`
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.js') return 'text/javascript; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.json') return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}

function serveStatic(request, response) {
  const staticDir = path.resolve(process.env.TONG_LEDGER_STATIC_DIR || process.env.LEDGER_STATIC_DIR || DEFAULT_STATIC_DIR)
  const url = new URL(request.url || '/', 'http://localhost')
  let relative = url.pathname
  if (relative === '/' || relative === APP_BASE_PATH) relative = '/index.html'
  else if (relative.startsWith(`${APP_BASE_PATH}/`)) relative = relative.slice(APP_BASE_PATH.length)
  const normalized = path.normalize(decodeURIComponent(relative)).replace(/^(\.\.[/\\])+/, '')
  const filePath = path.resolve(staticDir, normalized.replace(/^[/\\]/, ''))
  if (!filePath.startsWith(staticDir)) {
    textResponse(response, 403, 'Forbidden')
    return
  }
  const targetPath = fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? filePath
    : path.join(staticDir, 'index.html')
  if (!fs.existsSync(targetPath)) {
    textResponse(response, 404, 'Static bundle not found')
    return
  }
  response.writeHead(200, {
    'Content-Type': mimeType(targetPath),
    'Cache-Control': path.basename(targetPath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  fs.createReadStream(targetPath).pipe(response)
}

async function proxyOpenAiCompatible(request, response, pathname) {
  const upstream = (process.env.CODEX_LB_UPSTREAM || process.env.OPENAI_PROXY_UPSTREAM || 'http://127.0.0.1:2455')
    .replace(/\/+$/g, '')
  const stripPrefix = pathname.startsWith(`${APP_BASE_PATH}/api/openai`)
    ? `${APP_BASE_PATH}/api/openai`
    : '/api/openai'
  const upstreamPath = pathname.slice(stripPrefix.length) || '/'
  const target = `${upstream}${upstreamPath}${new URL(request.url || '/', 'http://localhost').search}`
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : await readBody(request, 100 * 1024 * 1024)
  const headers = {
    'Content-Type': request.headers['content-type'] || 'application/json',
  }
  const upstreamKey = process.env.CODEX_LB_API_KEY || process.env.OPENAI_PROXY_API_KEY || ''
  if (upstreamKey) {
    headers.Authorization = `Bearer ${upstreamKey}`
  } else if (request.headers.authorization) {
    headers.Authorization = request.headers.authorization
  }
  const upstreamResponse = await fetch(target, {
    method: request.method,
    headers,
    body,
  })
  const responseHeaders = {
    'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }
  response.writeHead(upstreamResponse.status, responseHeaders)
  response.end(Buffer.from(await upstreamResponse.arrayBuffer()))
}

function normalizeCell(cell, index) {
  return {
    cellId: String(cell.cellId || cell.cropRef || `cell-${index + 1}`),
    cropRef: String(cell.cropRef || cell.cellId || `cell-${index + 1}`),
    cropImageDataUrl: String(cell.cropImageDataUrl || ''),
    row: Number.isFinite(Number(cell.row)) ? Number(cell.row) : null,
    columnLabel: String(cell.columnLabel || ''),
    columnKind: String(cell.columnKind || ''),
  }
}

function buildCellPrompt(cells) {
  return [
    '你是 tong账本 的单格手写识别引擎。',
    '每张图是固定账本中的一个单元格裁剪图。只读这个格子，不做整页计算，不根据总额反推。',
    '返回 JSON：{ "readings": [...] }。',
    '每个 reading 包含 cellId、cropRef、text、candidates、kind、confidence、note。',
    'kind 只能是 number、mark、blank、text 或 uncertain。',
    '如果是空白格，text 为空字符串，kind=blank。',
    '如果是 X、划线、对勾等非金额标记，kind=mark。',
    '如果主要是红色人工验算式、红色合计或红色下划线，kind=text，不要把红字验算结果当成本格原始金额。',
    '普通手写金额或数量用 kind=number。候选值要保留可能混淆，例如 570/510、8/3、1/7。',
    'confidence 是 0-1；清楚单格可高，压线/跨格/红字干扰/多候选要降。',
    '本轮裁剪图：',
    ...cells.map((cell, index) => {
      const row = cell.row ? `${cell.row}日` : '未知日期'
      return `- 图${index + 1}: ${cell.cropRef} / ${row}${cell.columnLabel || cell.columnKind}`
    }),
  ].join('\n')
}

function mockReadCells(cells) {
  return {
    readings: cells.map((cell) => ({
      cellId: cell.cellId,
      cropRef: cell.cropRef,
      text: '',
      candidates: [],
      kind: 'uncertain',
      confidence: 0.2,
      note: 'mock server: no OCR provider configured',
    })),
  }
}

async function callOpenAiCompatibleCellOcr(cells) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.VISION_API_KEY
  const model = process.env.CELL_OCR_MODEL || process.env.VISION_MODEL || 'gpt-4o-mini'
  const baseUrl = (process.env.OPENAI_BASE_URL || process.env.VISION_API_BASE_URL || DEFAULT_OPENAI_BASE_URL)
    .replace(/\/+$/g, '')
  if (!apiKey) return mockReadCells(cells)

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
            { type: 'text', text: buildCellPrompt(cells) },
            ...cells.flatMap((cell, index) => [
              { type: 'text', text: `图${index + 1}: ${cell.cropRef}` },
              { type: 'image_url', image_url: { url: cell.cropImageDataUrl, detail: 'high' } },
            ]),
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Cell OCR request failed: ${response.status}`)
  }
  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('Cell OCR response did not include text content.')
  const parsed = parseJson(content)
  const readings = Array.isArray(parsed.readings) ? parsed.readings : []
  return {
    readings: readings.map((reading, index) => {
      const sourceCell = cells[index]
      return {
        cellId: String(reading.cellId || sourceCell?.cellId || `cell-${index + 1}`),
        cropRef: String(reading.cropRef || sourceCell?.cropRef || `cell-${index + 1}`),
        text: typeof reading.text === 'string' ? reading.text : '',
        candidates: Array.isArray(reading.candidates) ? reading.candidates.map(String) : [],
        kind: ['number', 'mark', 'blank', 'text', 'uncertain'].includes(reading.kind)
          ? reading.kind
          : 'uncertain',
        confidence: Number.isFinite(Number(reading.confidence)) ? Number(reading.confidence) : 0.2,
        note: typeof reading.note === 'string' ? reading.note : '',
      }
    }),
  }
}

async function handleRecognizeCells(request, response) {
  try {
    const body = JSON.parse(await readBody(request))
    const cells = Array.isArray(body.cells) ? body.cells.map(normalizeCell) : []
    const validCells = cells.filter((cell) => cell.cropImageDataUrl.startsWith('data:image/'))
    if (!validCells.length) {
      jsonResponse(response, 400, { error: 'cells[].cropImageDataUrl is required.' })
      return
    }
    const result = await callOpenAiCompatibleCellOcr(validCells)
    jsonResponse(response, 200, {
      provider: process.env.OPENAI_API_KEY || process.env.VISION_API_KEY ? 'openai-compatible' : 'mock',
      ...result,
    })
  } catch (error) {
    jsonResponse(response, 500, { error: error instanceof Error ? error.message : 'Cell OCR failed.' })
  }
}

async function handleDatePreflight(_request, response) {
  jsonResponse(response, 501, {
    error: 'date-preflight provider is not configured in this server starter.',
    contract: {
      request: { imageDataUrl: 'data:image/jpeg;base64,...' },
      response: {
        status: 'complete | review | incomplete',
        dateCount: 31,
        dateRange: '1-31',
        datesPresent: [1, 2, 3],
        datesMissing: [],
        note: 'implementation-specific note',
      },
    },
  })
}

const { port, host } = serverListenConfig()

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost')
  const pathname = url.pathname

  if (request.method === 'OPTIONS') {
    jsonResponse(response, 200, { ok: true })
    return
  }
  if (request.method === 'GET' && (pathname === '/api/health' || pathname === `${APP_BASE_PATH}/api/health`)) {
    jsonResponse(response, 200, {
      ok: true,
      service: 'tong-ledger-server',
      auth: authConfig().enabled ? 'enabled' : 'disabled',
    })
    return
  }

  if (request.method === 'GET' && pathname === LOGIN_PATH) {
    htmlResponse(response, 200, loginHtml())
    return
  }
  if (request.method === 'POST' && pathname === LOGIN_PATH) {
    const form = new URLSearchParams(await readBody(request, 128 * 1024))
    const config = authConfig()
    if (config.enabled && safeEqual(form.get('password') || '', config.password)) {
      response.writeHead(303, {
        Location: APP_BASE_PATH,
        'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(config.token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
        'Cache-Control': 'no-store',
      })
      response.end()
      return
    }
    htmlResponse(response, 401, loginHtml('密码不对。'))
    return
  }

  if (!isAuthed(request)) {
    if (pathname.startsWith('/api/') || pathname.startsWith(`${APP_BASE_PATH}/api/`)) {
      jsonResponse(response, 401, { error: 'Authentication required.' })
      return
    }
    redirectResponse(response, LOGIN_PATH)
    return
  }

  if (request.method === 'POST' && (pathname === '/api/recognize/cells' || pathname === `${APP_BASE_PATH}/api/recognize/cells`)) {
    await handleRecognizeCells(request, response)
    return
  }
  if (request.method === 'POST' && (pathname === '/api/date-preflight' || pathname === `${APP_BASE_PATH}/api/date-preflight`)) {
    await handleDatePreflight(request, response)
    return
  }
  if (pathname.startsWith('/api/openai/') || pathname.startsWith(`${APP_BASE_PATH}/api/openai/`)) {
    await proxyOpenAiCompatible(request, response, pathname)
    return
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    serveStatic(request, response)
    return
  }
  textResponse(response, 404, 'Not found')
})

server.listen(port, host, () => {
  console.log(`tong ledger server listening on http://${host}:${port}`)
})
