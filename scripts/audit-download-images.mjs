import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.heic'])
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultInputDir = path.join(process.env.HOME || '', 'Downloads')
const defaultOutDir = path.join(repoRoot, 'reports', 'downloads-ledger-audit')

function readArg(name, fallback) {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : fallback
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function runVisionOcr(filePath) {
  const stdout = execFileSync('swift', [path.join(repoRoot, 'scripts', 'vision-ocr.swift'), filePath], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  return JSON.parse(stdout)
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

  const present = Array.from(dates).sort((a, b) => a - b)
  const missing = []
  for (let day = 1; day <= 31; day += 1) {
    if (!dates.has(day)) missing.push(day)
  }

  return { present, missing }
}

function classify({ width, height, dates }) {
  const landscape = width > height
  const complete31 = dates.present.length === 31 && dates.missing.length === 0

  if (complete31 && !landscape) return 'complete-page-candidate'
  if (complete31 && landscape) return 'rotate-before-model'
  if (dates.present.length >= 27) return 'review-before-model'
  return 'incomplete-or-cropped'
}

function rowForImage(filePath) {
  const ocr = runVisionOcr(filePath)
  const dates = parseDates(ocr.items)
  const firstDate = dates.present[0] ?? null
  const lastDate = dates.present.at(-1) ?? null
  const hash = sha256(filePath)

  return {
    file: path.basename(filePath),
    path: filePath,
    sha256: hash,
    sha256Short: hash.slice(0, 16),
    width: ocr.width,
    height: ocr.height,
    orientation: ocr.width > ocr.height ? 'landscape' : 'portrait',
    localOcrTokenCount: ocr.items.length,
    localOcrDateCount: dates.present.length,
    localOcrDateRange: firstDate && lastDate ? `${firstDate}-${lastDate}` : 'none',
    localOcrDatesPresent: dates.present,
    localOcrDatesMissing: dates.missing,
    bucket: classify({ width: ocr.width, height: ocr.height, dates }),
    topLocalOcrText: ocr.items.slice(0, 18).map((item) => item.text),
  }
}

function summarize(rows) {
  const byBucket = rows.reduce((counts, row) => {
    counts[row.bucket] = (counts[row.bucket] || 0) + 1
    return counts
  }, {})
  const landscape = rows.filter((row) => row.orientation === 'landscape').length
  const ocrComplete31 = rows.filter((row) => row.localOcrDateCount === 31).length

  return {
    total: rows.length,
    ocrComplete31,
    ocrIncomplete: rows.length - ocrComplete31,
    portrait: rows.length - landscape,
    landscape,
    byBucket,
  }
}

function formatMissing(missing) {
  if (!missing.length) return ''
  const head = missing.slice(0, 8).join(',')
  return missing.length > 8 ? `${head}...` : head
}

function markdownReport(summary, rows) {
  const lines = [
    '# Downloads Ledger Grid-Cut Audit',
    '',
    'This report is generated locally. It uses Apple Vision readout through `scripts/vision-ocr.swift` only to triage page completeness and does not call any model API.',
    '',
    '## Summary',
    '',
    `- Total images: ${summary.total}`,
    `- Local readout complete 1-31 date rows: ${summary.ocrComplete31}`,
    `- Local readout incomplete or risky: ${summary.ocrIncomplete}`,
    `- Portrait: ${summary.portrait}`,
    `- Landscape: ${summary.landscape}`,
    '',
    '## Buckets',
    '',
    '| bucket | count |',
    '| --- | ---: |',
    ...Object.entries(summary.byBucket)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, count]) => `| ${bucket} | ${count} |`),
    '',
    '## Images',
    '',
    '| file | size | ocr dates | missing | bucket | sha256 |',
    '| --- | --- | ---: | --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${row.file} | ${row.width}x${row.height} | ${row.localOcrDateRange} (${row.localOcrDateCount}) | ${formatMissing(row.localOcrDatesMissing)} | ${row.bucket} | ${row.sha256Short} |`,
    ),
    '',
  ]

  return `${lines.join('\n')}\n`
}

const inputDir = path.resolve(readArg('dir', defaultInputDir))
const outDir = path.resolve(readArg('out', defaultOutDir))

if (!existsSync(inputDir)) {
  throw new Error(`Input directory does not exist: ${inputDir}`)
}

const imagePaths = readdirSync(inputDir)
  .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
  .sort((a, b) => a.localeCompare(b))
  .map((name) => path.join(inputDir, name))

mkdirSync(outDir, { recursive: true })

const rows = imagePaths.map(rowForImage)
const summary = summarize(rows)
const generatedAt = new Date().toISOString()

writeFileSync(
  path.join(outDir, 'manifest.json'),
  `${JSON.stringify({ generatedAt, inputDir, summary, images: rows }, null, 2)}\n`,
)
writeFileSync(path.join(outDir, 'summary.md'), markdownReport(summary, rows))

console.log(JSON.stringify({ generatedAt, inputDir, outDir, summary }, null, 2))
