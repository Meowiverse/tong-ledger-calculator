import http from 'node:http'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const visionScript = path.join(repoRoot, 'scripts', 'vision-ocr.swift')

function readArg(name, fallback) {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : fallback
}

function parseDates(items) {
  const dates = new Set()
  for (const item of items) {
    const text = String(item.text || '').trim().replace(/\s+/g, '')
    const match = text.match(/^(\d{1,2})日$/)
    if (!match) continue
    const day = Number(match[1])
    if (Number.isInteger(day) && day >= 1 && day <= 31) dates.add(day)
  }

  const datesPresent = Array.from(dates).sort((left, right) => left - right)
  const datesMissing = []
  for (let day = 1; day <= 31; day += 1) {
    if (!dates.has(day)) datesMissing.push(day)
  }
  const first = datesPresent[0] ?? null
  const last = datesPresent.at(-1) ?? null
  return {
    datesPresent,
    datesMissing,
    dateRange: first && last ? `${first}-${last}` : 'none',
  }
}

function classify(dates) {
  if (dates.datesPresent.length === 31 && dates.datesMissing.length === 0) return 'complete'
  if (dates.datesPresent.length >= 27) return 'review'
  return 'incomplete'
}

function jsonResponse(response, status, payload) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function textResponse(response, status, text) {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'text/plain; charset=utf-8',
  })
  response.end(text)
}

function readBody(request, limitBytes = 24 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limitBytes) {
        reject(new Error('请求图片过大，请先压缩后再预审。'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new Error('imageDataUrl 必须是 base64 data URL。')
  const mime = match[1]
  const extension =
    mime === 'image/png' ? '.png' :
    mime === 'image/webp' ? '.webp' :
    mime === 'image/heic' ? '.heic' :
    '.jpg'
  return {
    extension,
    buffer: Buffer.from(match[2], 'base64'),
  }
}

function runVisionOcr(imagePath) {
  return new Promise((resolve, reject) => {
    execFile('swift', [visionScript, imagePath], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch {
        reject(new Error('Apple Vision OCR 返回内容不是 JSON。'))
      }
    })
  })
}

async function handleDatePreflight(request, response) {
  let tempDir = ''
  try {
    const raw = await readBody(request)
    const parsed = JSON.parse(raw)
    const { extension, buffer } = decodeDataUrl(parsed.imageDataUrl)
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'tong-ledger-date-'))
    const imagePath = path.join(tempDir, `ledger${extension}`)
    await writeFile(imagePath, buffer)
    const ocr = await runVisionOcr(imagePath)
    const dates = parseDates(Array.isArray(ocr.items) ? ocr.items : [])
    const status = classify(dates)
    jsonResponse(response, 200, {
      status,
      dateCount: dates.datesPresent.length,
      dateRange: dates.dateRange,
      datesPresent: dates.datesPresent,
      datesMissing: dates.datesMissing,
      note:
        status === 'complete'
          ? '本机 Apple Vision 确认日期 1-31 齐全。'
          : `本机 Apple Vision 日期预审未齐全：${dates.dateRange}（${dates.datesPresent.length}/31）。`,
    })
  } catch (error) {
    textResponse(response, 400, error instanceof Error ? error.message : '日期预审失败。')
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

const host = readArg('host', '127.0.0.1')
const port = Number(readArg('port', '8787')) || 8787

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    jsonResponse(response, 200, { ok: true })
    return
  }
  if (request.method === 'GET' && request.url === '/health') {
    jsonResponse(response, 200, { ok: true, service: 'tong-ledger-local-date-preflight' })
    return
  }
  if (request.method === 'POST' && request.url === '/date-preflight') {
    await handleDatePreflight(request, response)
    return
  }
  textResponse(response, 404, 'Not found')
})

server.listen(port, host, () => {
  console.log(`tong ledger local date preflight listening on http://${host}:${port}`)
})
