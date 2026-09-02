import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-5.5'
const DEFAULT_MANIFEST = 'reports/downloads-ledger-audit/manifest.json'

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

function readBoolArg(name, fallback = false) {
  const value = readArg(name)
  if (!value) return fallback
  return value === '1' || value === 'true' || value === 'yes'
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, numeric))
}

function extForDataUrl(dataUrl) {
  const match = /^data:image\/([a-z0-9.+-]+);base64,/i.exec(dataUrl)
  const ext = match?.[1]?.toLowerCase()
  if (ext === 'jpeg') return 'jpg'
  if (ext === 'png' || ext === 'webp' || ext === 'jpg') return ext
  return 'png'
}

function byteLengthForDataUrl(dataUrl) {
  const [, base64 = ''] = dataUrl.split(',', 2)
  return Buffer.byteLength(base64, 'base64')
}

function writeDataUrl(outputPath, dataUrl) {
  const [, base64 = ''] = dataUrl.split(',', 2)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'))
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

function loadImagesFromManifest(manifestPath, limit) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const images = (manifest.images || [])
    .filter((item) => item.bucket === 'complete-page-candidate')
    .map((item) => item.path)
    .filter((item) => item && fs.existsSync(item))
  return images.slice(0, limit)
}

async function createImageVariants(page, filePath, {
  blackFormat,
  blackQuality,
  blackThreshold,
  maskCalcZone,
  maxEdge,
  redDilate,
  redFallbackFormat,
  redFallbackQuality,
  redFormat,
  redMinPixels,
  redPadding,
  redQuality,
  trimPage,
}) {
  const sourceDataUrl = imageToDataUrl(filePath)
  return page.evaluate(async ({
    dataUrl,
    blackFormat,
    blackQuality,
    blackThreshold,
    maskCalcZone,
    maxEdge,
    redDilate,
    redFallbackFormat,
    redFallbackQuality,
    redFormat,
    redMinPixels,
    redPadding,
    redQuality,
    trimPage,
  }) => {
    function loadImage(url) {
      return new Promise((resolve, reject) => {
        const image = new Image()
        image.addEventListener('load', () => resolve(image))
        image.addEventListener('error', () => reject(new Error('image load failed')))
        image.src = url
      })
    }
    function isRedInk(red, green, blue) {
      const dominance = red - Math.max(green, blue)
      const saturation = red - Math.min(green, blue)
      return red > 92 && dominance > 18 && saturation > 30 && red > green * 1.08 && red > blue * 1.18
    }
    function mimeForFormat(format) {
      if (format === 'png') return 'image/png'
      if (format === 'webp') return 'image/webp'
      return 'image/jpeg'
    }
    function encodeCanvas(targetCanvas, format, quality) {
      return format === 'png'
        ? targetCanvas.toDataURL('image/png')
        : targetCanvas.toDataURL(mimeForFormat(format), quality)
    }
    function cropImageData(imageData, sourceWidth, sourceHeight, box) {
      const cropCanvas = document.createElement('canvas')
      cropCanvas.width = Math.max(1, box.width)
      cropCanvas.height = Math.max(1, box.height)
      const cropContext = cropCanvas.getContext('2d', { willReadFrequently: true })
      const next = cropContext.createImageData(cropCanvas.width, cropCanvas.height)
      for (let y = 0; y < cropCanvas.height; y += 1) {
        const sourceY = Math.min(sourceHeight - 1, box.y + y)
        for (let x = 0; x < cropCanvas.width; x += 1) {
          const sourceX = Math.min(sourceWidth - 1, box.x + x)
          const sourceOffset = (sourceY * sourceWidth + sourceX) * 4
          const targetOffset = (y * cropCanvas.width + x) * 4
          next.data[targetOffset] = imageData.data[sourceOffset]
          next.data[targetOffset + 1] = imageData.data[sourceOffset + 1]
          next.data[targetOffset + 2] = imageData.data[sourceOffset + 2]
          next.data[targetOffset + 3] = imageData.data[sourceOffset + 3]
        }
      }
      cropContext.putImageData(next, 0, 0)
      return cropCanvas
    }
    function paddedBox(box, sourceWidth, sourceHeight, paddingX, paddingY) {
      const left = Math.max(0, Math.floor(box.left - paddingX))
      const top = Math.max(0, Math.floor(box.top - paddingY))
      const right = Math.min(sourceWidth - 1, Math.ceil(box.right + paddingX))
      const bottom = Math.min(sourceHeight - 1, Math.ceil(box.bottom + paddingY))
      return { x: left, y: top, width: Math.max(1, right - left + 1), height: Math.max(1, bottom - top + 1) }
    }
    function normalizedBox(sourceWidth, sourceHeight, box) {
      const left = Math.max(0, Math.floor(sourceWidth * box.x0))
      const top = Math.max(0, Math.floor(sourceHeight * box.y0))
      const right = Math.min(sourceWidth - 1, Math.ceil(sourceWidth * box.x1))
      const bottom = Math.min(sourceHeight - 1, Math.ceil(sourceHeight * box.y1))
      return { x: left, y: top, width: Math.max(1, right - left + 1), height: Math.max(1, bottom - top + 1) }
    }
    function fillBoxWhite(imageData, sourceWidth, box) {
      for (let y = box.y; y < box.y + box.height; y += 1) {
        for (let x = box.x; x < box.x + box.width; x += 1) {
          const offset = (y * sourceWidth + x) * 4
          imageData.data[offset] = 255
          imageData.data[offset + 1] = 255
          imageData.data[offset + 2] = 255
          imageData.data[offset + 3] = 255
        }
      }
    }
    function blackNeighborCount(mask, sourceWidth, sourceHeight, x, y) {
      let count = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy
        if (yy < 0 || yy >= sourceHeight) continue
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const xx = x + dx
          if (xx < 0 || xx >= sourceWidth) continue
          if (mask[yy * sourceWidth + xx]) count += 1
        }
      }
      return count
    }
    const image = await loadImage(dataUrl)
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
    const width = Math.max(1, Math.round(image.naturalWidth * scale))
    const height = Math.max(1, Math.round(image.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, width, height)
    const base = context.getImageData(0, 0, width, height)
    const redOnly = new ImageData(new Uint8ClampedArray(base.data), width, height)
    const gray = new Uint8ClampedArray(width * height)
    const redMask = new Uint8Array(width * height)
    const redBox = { left: width, top: height, right: -1, bottom: -1 }
    const contentBox = { left: width, top: height, right: -1, bottom: -1 }

    for (let pixel = 0; pixel < gray.length; pixel += 1) {
      const offset = pixel * 4
      const red = base.data[offset]
      const green = base.data[offset + 1]
      const blue = base.data[offset + 2]
      const redInk = isRedInk(red, green, blue)
      gray[pixel] = redInk ? 255 : Math.round(red * 0.299 + green * 0.587 + blue * 0.114)
      if (redInk) {
        const x = pixel % width
        const y = Math.floor(pixel / width)
        redMask[pixel] = 1
        redBox.left = Math.min(redBox.left, x)
        redBox.top = Math.min(redBox.top, y)
        redBox.right = Math.max(redBox.right, x)
        redBox.bottom = Math.max(redBox.bottom, y)
      }
      redOnly.data[offset] = 255
      redOnly.data[offset + 1] = 255
      redOnly.data[offset + 2] = 255
      redOnly.data[offset + 3] = 255
    }

    const blackMask = new Uint8Array(width * height)
    const blackOnly = new ImageData(new Uint8ClampedArray(base.data), width, height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x
        blackMask[pixel] = gray[pixel] < blackThreshold ? 1 : 0
      }
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x
        const offset = pixel * 4
        const dark = blackMask[pixel] === 1
        const neighbors = dark ? blackNeighborCount(blackMask, width, height, x, y) : 0
        const strongInk = gray[pixel] < blackThreshold - 35
        const value = dark && (strongInk || neighbors >= 2) ? 0 : 255
        if (value === 0) {
          contentBox.left = Math.min(contentBox.left, x)
          contentBox.top = Math.min(contentBox.top, y)
          contentBox.right = Math.max(contentBox.right, x)
          contentBox.bottom = Math.max(contentBox.bottom, y)
        }
        blackOnly.data[offset] = value
        blackOnly.data[offset + 1] = value
        blackOnly.data[offset + 2] = value
        blackOnly.data[offset + 3] = 255
      }
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let hit = false
        for (let dy = -redDilate; dy <= redDilate && !hit; dy += 1) {
          const yy = y + dy
          if (yy < 0 || yy >= height) continue
          for (let dx = -redDilate; dx <= redDilate; dx += 1) {
            const xx = x + dx
            if (xx < 0 || xx >= width) continue
            if (redMask[yy * width + xx]) {
              hit = true
              break
            }
          }
        }
        if (hit) {
          const offset = (y * width + x) * 4
          redOnly.data[offset] = 130
          redOnly.data[offset + 1] = 0
          redOnly.data[offset + 2] = 0
        }
      }
    }

    const auditFallbackBox = normalizedBox(width, height, { x0: 0.54, y0: 0.1, x1: 0.93, y1: 0.45 })
    if (maskCalcZone) fillBoxWhite(blackOnly, width, auditFallbackBox)

    const hasContent = contentBox.right >= contentBox.left && contentBox.bottom >= contentBox.top
    const blackBox = trimPage && hasContent
      ? paddedBox(contentBox, width, height, width * 0.025, height * 0.025)
      : { x: 0, y: 0, width, height }
    const blackCanvas = cropImageData(blackOnly, width, height, blackBox)
    const blackDataUrl = encodeCanvas(blackCanvas, blackFormat, blackQuality)

    const redPixelCount = redMask.reduce((sum, value) => sum + value, 0)
    const hasRed = redBox.right >= redBox.left && redBox.bottom >= redBox.top && redPixelCount >= redMinPixels
    const redBoxPadded = hasRed ? paddedBox(redBox, width, height, width * redPadding, height * redPadding) : null
    let redCanvas
    let redSource = 'red-mask'
    if (redBoxPadded) {
      redCanvas = cropImageData(redOnly, width, height, redBoxPadded)
    } else {
      redCanvas = cropImageData(base, width, height, auditFallbackBox)
      redSource = 'audit-zone-fallback'
    }
    const redOutputFormat = redSource === 'audit-zone-fallback' ? redFallbackFormat : redFormat
    const redOutputQuality = redSource === 'audit-zone-fallback' ? redFallbackQuality : redQuality
    const redDataUrl = encodeCanvas(redCanvas, redOutputFormat, redOutputQuality)

    return {
      blackDataUrl,
      redDataUrl,
      width,
      height,
      blackWidth: blackCanvas.width,
      blackHeight: blackCanvas.height,
      redWidth: redCanvas.width,
      redHeight: redCanvas.height,
      redPixelCount,
      redSource,
      blackBox,
      redBox: redBoxPadded || auditFallbackBox,
    }
  }, {
    dataUrl: sourceDataUrl,
    blackFormat,
    blackQuality,
    blackThreshold,
    maskCalcZone,
    maxEdge,
    redDilate,
    redFallbackFormat,
    redFallbackQuality,
    redFormat,
    redMinPixels,
    redPadding,
    redQuality,
    trimPage,
  })
}

function buildPrompt(fileName) {
  return [
    '你是 tong账本 的黑字识别 + 红字验算评测引擎。',
    `当前文件：${fileName}`,
    '输入两张本地压缩处理后的图：第一张是去红并抹掉人工计算区后的二值化黑字账本图，第二张是裁剪后的红字/人工计算审计图。',
    '规则：只根据第一张黑字图读取 31 日固定账本的原始格子数据并计算 blackComputedTotal。',
    '红字/右上手工算式是人工计算结果，不是普通格子数据。根据第二张审计图提取 redFormulae、redComputedTotal 或 redWrittenTotal。',
    '不要为了匹配红字倒推修改黑字。黑字和红字不一致时，输出 difference、suspectCells、disagreements。',
    '如果看不清，写入 uncertainCells，不要猜成 100% 通过。',
    '只返回 JSON 对象，格式：{"blackComputedTotal":0,"redComputedTotal":0,"redWrittenTotal":0,"difference":0,"isMatch":false,"matchTolerance":0.5,"overallConfidence":0,"blackEntries":[{"day":1,"rawText":"","rawValue":0,"calculatedAmount":0,"confidence":0}],"redFormulae":[""],"suspectCells":[{"day":1,"issue":"","blackText":"","confidence":0}],"uncertainCells":[],"disagreements":[],"auditNotes":[]}',
  ].join('\n')
}

async function callModel({ apiKey, baseUrl, model, imagePath, blackDataUrl, redDataUrl }) {
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
            { type: 'text', text: buildPrompt(path.basename(imagePath)) },
            { type: 'text', text: '图1：去红后的黑字账本图，只用它读取格子和计算。' },
            { type: 'image_url', image_url: { url: blackDataUrl, detail: 'high' } },
            { type: 'text', text: '图2：红字/人工计算审计图，只用它提取人工结果并做对比。' },
            { type: 'image_url', image_url: { url: redDataUrl, detail: 'high' } },
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
  return {
    usage: payload.usage ?? null,
    result: parseJsonObject(payload?.choices?.[0]?.message?.content || ''),
  }
}

async function main() {
  const model = readArg('model', process.env.WHOLE_PAGE_MODEL || process.env.VISION_MODEL || DEFAULT_MODEL)
  if (model !== 'gpt-5.5') throw new Error('This batch smoke test is locked to gpt-5.5.')
  const baseUrl = readArg(
    'base-url',
    process.env.OPENAI_BASE_URL || process.env.AUTOROUTER_BASE_URL || process.env.VISION_API_BASE_URL || DEFAULT_BASE_URL,
  ).replace(/\/+$/g, '')
  const preprocessOnly = readBoolArg('preprocess-only', false)
  const apiKey = process.env.OPENAI_API_KEY || process.env.AUTOROUTER_API_KEY || process.env.VISION_API_KEY
  if (!apiKey && !preprocessOnly) throw new Error('No API key found. Set OPENAI_API_KEY, AUTOROUTER_API_KEY, or VISION_API_KEY.')

  const limit = Math.max(1, Math.min(50, Number(readArg('limit', '10')) || 10))
  const maxEdge = Math.max(700, Math.min(1600, Number(readArg('max-edge', '1100')) || 1100))
  const blackQuality = clampNumber(readArg('black-quality', '0.72'), 0.45, 0.95, 0.72)
  const blackThreshold = Math.round(clampNumber(readArg('black-threshold', '105'), 80, 220, 105))
  const redQuality = clampNumber(readArg('red-quality', '0.9'), 0.45, 1, 0.9)
  const blackFormat = ['jpeg', 'png', 'webp'].includes(readArg('black-format', 'webp')) ? readArg('black-format', 'webp') : 'webp'
  const redFormat = ['jpeg', 'png', 'webp'].includes(readArg('red-format', 'png')) ? readArg('red-format', 'png') : 'png'
  const redFallbackFormat = ['jpeg', 'png', 'webp'].includes(readArg('red-fallback-format', 'webp'))
    ? readArg('red-fallback-format', 'webp')
    : 'webp'
  const redFallbackQuality = clampNumber(readArg('red-fallback-quality', '0.72'), 0.45, 0.95, 0.72)
  const redDilate = Math.round(clampNumber(readArg('red-dilate', '2'), 0, 5, 2))
  const redMinPixels = Math.round(clampNumber(readArg('red-min-pixels', '80'), 0, 10000, 80))
  const redPadding = clampNumber(readArg('red-padding', '0.045'), 0.005, 0.2, 0.045)
  const maskCalcZone = readBoolArg('mask-calc-zone', true)
  const trimPage = readBoolArg('trim-page', true)
  const manifestPath = path.resolve(readArg('manifest', DEFAULT_MANIFEST))
  const outputDir = path.resolve(readArg('output-dir', 'reports/model-smoke'))
  const savePreviews = readBoolArg('save-previews', preprocessOnly)
  const previewDir = path.resolve(readArg('preview-dir', path.join(outputDir, 'previews', nowStamp())))
  const imagePaths = readArg('images')
    ? readArg('images').split(',').map((item) => path.resolve(item)).filter((item) => fs.existsSync(item))
    : loadImagesFromManifest(manifestPath, limit)
  if (!imagePaths.length) throw new Error('No images selected.')

  fs.mkdirSync(outputDir, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const report = {
    generatedAt: new Date().toISOString(),
    model,
    baseUrl,
    preprocessing: {
      blackQuality,
      blackFormat,
      blackThreshold,
      maxEdge,
      redQuality,
      redFormat,
      redFallbackFormat,
      redFallbackQuality,
      redDilate,
      redMinPixels,
      redPadding,
      maskCalcZone,
      trimPage,
      imagesPerRequest: 2,
      preprocessOnly,
    },
    manifestPath,
    imageCount: imagePaths.length,
    items: [],
    aggregate: null,
  }

  try {
    for (const [index, imagePath] of imagePaths.entries()) {
      const startedAt = Date.now()
      console.error(`[${index + 1}/${imagePaths.length}] ${path.basename(imagePath)}`)
      try {
        const variants = await createImageVariants(page, imagePath, {
          blackFormat,
          blackQuality,
          blackThreshold,
          maskCalcZone,
          maxEdge,
          redDilate,
          redFallbackFormat,
          redFallbackQuality,
          redFormat,
          redMinPixels,
          redPadding,
          redQuality,
          trimPage,
        })
        const variantStats = {
          sourceWidth: variants.width,
          sourceHeight: variants.height,
          blackWidth: variants.blackWidth,
          blackHeight: variants.blackHeight,
          redWidth: variants.redWidth,
          redHeight: variants.redHeight,
          redPixelCount: variants.redPixelCount,
          redSource: variants.redSource,
          blackBytes: byteLengthForDataUrl(variants.blackDataUrl),
          redBytes: byteLengthForDataUrl(variants.redDataUrl),
          blackBox: variants.blackBox,
          redBox: variants.redBox,
        }
        const previewPaths = {}
        if (savePreviews) {
          const stem = path.basename(imagePath).replace(/\.[^.]+$/, '')
          const blackPreviewPath = path.join(
            previewDir,
            `${String(index + 1).padStart(2, '0')}-${stem}.black.${extForDataUrl(variants.blackDataUrl)}`,
          )
          const redPreviewPath = path.join(
            previewDir,
            `${String(index + 1).padStart(2, '0')}-${stem}.red.${extForDataUrl(variants.redDataUrl)}`,
          )
          writeDataUrl(blackPreviewPath, variants.blackDataUrl)
          writeDataUrl(redPreviewPath, variants.redDataUrl)
          previewPaths.black = blackPreviewPath
          previewPaths.red = redPreviewPath
        }
        const { usage, result } = preprocessOnly
          ? { usage: null, result: null }
          : await callModel({
            apiKey,
            baseUrl,
            model,
            imagePath,
            blackDataUrl: variants.blackDataUrl,
            redDataUrl: variants.redDataUrl,
          })
        report.items.push({
          imagePath,
          file: path.basename(imagePath),
          ok: true,
          skippedModel: preprocessOnly,
          elapsedMs: Date.now() - startedAt,
          variants: variantStats,
          previewPaths,
          usage,
          result,
        })
      } catch (error) {
        report.items.push({
          imagePath,
          file: path.basename(imagePath),
          ok: false,
          elapsedMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message.slice(0, 2000) : 'unknown error',
        })
      }
      const outputPath = path.join(outputDir, `black-red-batch-${nowStamp()}-${model}.partial.json`)
      fs.writeFileSync(outputPath, JSON.stringify(report, null, 2))
    }
  } finally {
    await browser.close()
  }

  const successful = report.items.filter((item) => item.ok)
  const matched = successful.filter((item) => item.result?.isMatch === true)
  const diffs = successful
    .map((item) => Number(item.result?.difference))
    .filter((value) => Number.isFinite(value))
  const tokens = successful.reduce((sum, item) => sum + Number(item.usage?.total_tokens || 0), 0)
  report.aggregate = {
    total: report.items.length,
    successful: successful.length,
    failed: report.items.length - successful.length,
    matched: matched.length,
    matchRate: successful.length ? Math.round((matched.length / successful.length) * 1000) / 1000 : 0,
    averageAbsDifference: diffs.length
      ? Math.round((diffs.reduce((sum, value) => sum + Math.abs(value), 0) / diffs.length) * 100) / 100
      : null,
    maxAbsDifference: diffs.length ? Math.max(...diffs.map(Math.abs)) : null,
    totalTokens: tokens,
  }

  const finalPath = path.join(outputDir, `black-red-batch-${nowStamp()}-${model}.json`)
  fs.writeFileSync(finalPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    outputPath: finalPath,
    aggregate: report.aggregate,
    items: report.items.map((item) => ({
      file: item.file,
      ok: item.ok,
      skippedModel: item.skippedModel ?? false,
      elapsedMs: item.elapsedMs,
      variants: item.variants ?? null,
      previewPaths: item.previewPaths ?? null,
      totalTokens: item.usage?.total_tokens ?? null,
      blackComputedTotal: item.result?.blackComputedTotal ?? null,
      redComputedTotal: item.result?.redComputedTotal ?? null,
      redWrittenTotal: item.result?.redWrittenTotal ?? null,
      difference: item.result?.difference ?? null,
      isMatch: item.result?.isMatch ?? null,
      confidence: item.result?.overallConfidence ?? null,
      suspectCount: Array.isArray(item.result?.suspectCells) ? item.result.suspectCells.length : null,
      uncertainCount: Array.isArray(item.result?.uncertainCells) ? item.result.uncertainCells.length : null,
      error: item.error ?? null,
    })),
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'black-red batch smoke failed')
  process.exit(1)
})
