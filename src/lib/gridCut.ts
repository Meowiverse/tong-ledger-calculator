import { getTemplateGrid } from './paperTemplates'
import { detectGridLinesWithCnn } from './gridCutCnnModel'
import { predictGridCutModel } from './gridCutModel'
import type { GridCutEvidence, GridCutLine, ImageRegion, PaperTemplate } from '../types'

interface LoadedImage {
  width: number
  height: number
  canvas: HTMLCanvasElement
}

interface LineGroup {
  from: number
  to: number
  strength: number
}

interface MaskSummary {
  mask: Uint8Array
  darkRatio: number
  borderDensity: {
    top: number
    bottom: number
    left: number
    right: number
    center: number
  }
}

interface AxisEvidence {
  strengths: number[]
  continuity: number[]
  transitions: number[]
}

const MAX_ANALYSIS_EDGE = 900

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => reject(new Error('图片加载失败，无法做本地切格。')))
    image.src = dataUrl
  })
}

async function loadScaledImage(dataUrl: string): Promise<LoadedImage> {
  const image = await loadImage(dataUrl)
  const scale = Math.min(1, MAX_ANALYSIS_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('当前浏览器不支持 Canvas 图像分析。')
  context.drawImage(image, 0, 0, width, height)
  return { width, height, canvas }
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[clamp(Math.floor(sorted.length * ratio), 0, sorted.length - 1)]
}

function maxRun(values: Uint8Array, start: number, step: number, count: number) {
  let best = 0
  let current = 0
  for (let index = 0; index < count; index += 1) {
    if (values[start + index * step]) {
      current += 1
      if (current > best) best = current
    } else {
      current = 0
    }
  }
  return best
}

function smooth(values: number[], radius = 2) {
  return values.map((_, index) => {
    let total = 0
    let count = 0
    for (let offset = -radius; offset <= radius; offset += 1) {
      const value = values[index + offset]
      if (typeof value !== 'number') continue
      total += value
      count += 1
    }
    return count ? total / count : 0
  })
}

function continuityRatioHorizontal(mask: Uint8Array, width: number, x: number, y: number) {
  const offset = y * width + x
  if (!mask[offset]) return 0
  const leftNear = x > 0 && mask[offset - 1]
  const rightNear = x + 1 < width && mask[offset + 1]
  const leftFar = x > 1 && mask[offset - 2]
  const rightFar = x + 2 < width && mask[offset + 2]
  if ((leftNear && rightNear) || (leftFar && rightFar)) return 1
  if (leftNear || rightNear || leftFar || rightFar) return 0.5
  return 0
}

function continuityRatioVertical(mask: Uint8Array, width: number, height: number, x: number, y: number) {
  const offset = y * width + x
  if (!mask[offset]) return 0
  const upNear = y > 0 && mask[offset - width]
  const downNear = y + 1 < height && mask[offset + width]
  const upFar = y > 1 && mask[offset - width * 2]
  const downFar = y + 2 < height && mask[offset + width * 2]
  if ((upNear && downNear) || (upFar && downFar)) return 1
  if (upNear || downNear || upFar || downFar) return 0.5
  return 0
}

function buildAxisEvidence(mask: Uint8Array, width: number, height: number): {
  rows: AxisEvidence
  columns: AxisEvidence
} {
  const rowStrengths: number[] = []
  const rowContinuity: number[] = []
  const rowTransitions: number[] = []
  const columnStrengths: number[] = []
  const columnContinuity: number[] = []
  const columnTransitions: number[] = []

  for (let y = 0; y < height; y += 1) {
    let dark = 0
    let continuity = 0
    let transitions = 0
    let previous = mask[y * width]
    for (let x = 0; x < width; x += 1) {
      const value = mask[y * width + x]
      dark += value
      continuity += continuityRatioHorizontal(mask, width, x, y)
      if (x > 0 && value !== previous) transitions += 1
      previous = value
    }
    const density = dark / width
    const run = maxRun(mask, y * width, 1, width) / width
    const continuityRatio = continuity / width
    const transitionRatio = transitions / Math.max(width - 1, 1)
    rowContinuity.push(continuityRatio)
    rowTransitions.push(transitionRatio)
    rowStrengths.push(clamp(run * 0.54 + continuityRatio * 0.32 + density * 0.24 - transitionRatio * 0.12, 0, 1))
  }

  for (let x = 0; x < width; x += 1) {
    let dark = 0
    let continuity = 0
    let transitions = 0
    let previous = mask[x]
    for (let y = 0; y < height; y += 1) {
      const value = mask[y * width + x]
      dark += value
      continuity += continuityRatioVertical(mask, width, height, x, y)
      if (y > 0 && value !== previous) transitions += 1
      previous = value
    }
    const density = dark / height
    const run = maxRun(mask, x, width, height) / height
    const continuityRatio = continuity / height
    const transitionRatio = transitions / Math.max(height - 1, 1)
    columnContinuity.push(continuityRatio)
    columnTransitions.push(transitionRatio)
    columnStrengths.push(
      clamp(run * 0.54 + continuityRatio * 0.32 + density * 0.24 - transitionRatio * 0.12, 0, 1),
    )
  }

  return {
    rows: {
      strengths: smooth(rowStrengths),
      continuity: smooth(rowContinuity),
      transitions: smooth(rowTransitions),
    },
    columns: {
      strengths: smooth(columnStrengths),
      continuity: smooth(columnContinuity),
      transitions: smooth(columnTransitions),
    },
  }
}

function groupPeaks(strengths: number[], threshold: number, minGap = 2) {
  const groups: LineGroup[] = []
  let active: LineGroup | null = null

  strengths.forEach((strength, index) => {
    if (strength >= threshold) {
      if (!active) active = { from: index, to: index, strength }
      active.to = index
      active.strength = Math.max(active.strength, strength)
      return
    }

    if (!active) return
    groups.push(active)
    active = null
  })

  if (active) groups.push(active)

  return groups.reduce<LineGroup[]>((merged, group) => {
    const previous = merged.at(-1)
    if (previous && group.from - previous.to <= minGap) {
      previous.to = group.to
      previous.strength = Math.max(previous.strength, group.strength)
    } else {
      merged.push({ ...group })
    }
    return merged
  }, [])
}

function toLine(group: LineGroup, axis: 'x' | 'y', size: number): GridCutLine {
  return {
    axis,
    position: round(((group.from + group.to) / 2 / size) * 100),
    strength: round(group.strength, 3),
  }
}

function expectedPositions(region: ImageRegion, expectedCount: number, axis: 'x' | 'y') {
  if (expectedCount <= 1) return []
  const start = axis === 'x' ? region.x : region.y
  const span = axis === 'x' ? region.width : region.height
  const step = span / Math.max(expectedCount - 1, 1)
  return Array.from({ length: expectedCount }, (_, index) => round(start + step * index))
}

function alignLinesToTemplate(
  lines: GridCutLine[],
  region: ImageRegion,
  expectedCount: number,
  axis: 'x' | 'y',
  options?: {
    allowProjection?: boolean
  },
) {
  const sorted = [...lines].sort((left, right) => left.position - right.position)
  if (sorted.length < 2 && !options?.allowProjection) {
    return { lines: sorted, syntheticCount: 0, matchedCount: sorted.length }
  }

  const span = axis === 'x' ? region.width : region.height
  const tolerance = Math.max(1.2, span / Math.max(expectedCount - 1, 1) * 0.48)
  const supportRatio = clamp(sorted.length / Math.max(expectedCount, 1), 0, 1)
  const matched = new Set<number>()
  let syntheticCount = 0
  let matchedCount = 0
  const aligned = expectedPositions(region, expectedCount, axis).map((position) => {
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    sorted.forEach((line, index) => {
      if (matched.has(index)) return
      const distance = Math.abs(line.position - position)
      if (distance <= tolerance && distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    })

    if (bestIndex === -1) {
      syntheticCount += 1
      return {
        axis,
        position,
        strength: 0.16,
      } satisfies GridCutLine
    }

    matched.add(bestIndex)
    matchedCount += 1
    const line = sorted[bestIndex]
    const distancePenalty = clamp(bestDistance / Math.max(tolerance, 0.001), 0, 1)
    const blend = clamp(
      0.22 + supportRatio * 0.28 + line.strength * 0.34 - distancePenalty * 0.28,
      0.18,
      0.82,
    )
    return {
      axis,
      position: round(position * (1 - blend) + line.position * blend),
      strength: round(Math.max(line.strength, 0.22), 3),
    } satisfies GridCutLine
  })

  return { lines: aligned, syntheticCount, matchedCount }
}

function templateAssistedCoverage(
  detectedCount: number,
  expectedCount: number,
  matchedCount: number,
  syntheticCount: number,
  axis: 'x' | 'y',
) {
  const rawCoverage = clamp(detectedCount / Math.max(expectedCount, 1), 0, 1)
  const matchedCoverage = clamp(matchedCount / Math.max(expectedCount, 1), 0, 1)
  if (!syntheticCount) return Math.max(rawCoverage, matchedCoverage)
  if (axis === 'x' && detectedCount >= 2) return Math.max(rawCoverage, 0.72, matchedCoverage * 0.92)
  if (axis === 'y' && detectedCount >= Math.max(8, Math.round(expectedCount * 0.25))) {
    return Math.max(rawCoverage, 0.68, matchedCoverage * 0.88)
  }
  return Math.max(rawCoverage, matchedCoverage * 0.74)
}

function fuseLineCandidates(primary: GridCutLine[], secondary: GridCutLine[], tolerance = 1.8) {
  const merged = [...primary].sort((left, right) => left.position - right.position)

  for (const candidate of secondary) {
    const nearestIndex = merged.findIndex((line) => Math.abs(line.position - candidate.position) <= tolerance)
    if (nearestIndex >= 0) {
      const current = merged[nearestIndex]
      const totalStrength = current.strength + candidate.strength
      merged[nearestIndex] = {
        ...current,
        position: round(
          (current.position * current.strength + candidate.position * candidate.strength) / Math.max(totalStrength, 0.001),
        ),
        strength: round(Math.max(current.strength, candidate.strength), 3),
      }
      continue
    }

    if (candidate.strength >= 0.6) merged.push(candidate)
  }

  return merged.sort((left, right) => left.position - right.position)
}

function regionFromLines(
  horizontal: GridCutLine[],
  vertical: GridCutLine[],
  fallback: ImageRegion,
): { region: ImageRegion; fallback: { x: boolean; y: boolean } } {
  const horizontalSpan =
    horizontal.length >= 2 ? (horizontal.at(-1)?.position ?? horizontal[0].position) - horizontal[0].position : 0
  const verticalSpan =
    vertical.length >= 2 ? (vertical.at(-1)?.position ?? vertical[0].position) - vertical[0].position : 0
  const usableHorizontal = horizontal.length >= 8 && horizontalSpan >= fallback.height * 0.74
  const usableVertical = vertical.length >= 4 && verticalSpan >= fallback.width * 0.68
  const top = usableHorizontal ? horizontal[0].position : fallback.y
  const bottom = usableHorizontal ? horizontal.at(-1)?.position ?? fallback.y + fallback.height : fallback.y + fallback.height
  const left = usableVertical ? vertical[0].position : fallback.x
  const right = usableVertical ? vertical.at(-1)?.position ?? fallback.x + fallback.width : fallback.x + fallback.width

  return {
    region: {
      x: clamp(round(left), 0, 99),
      y: clamp(round(top), 0, 99),
      width: clamp(round(right - left), 1, 100 - left),
      height: clamp(round(bottom - top), 1, 100 - top),
    },
    fallback: {
      x: !usableVertical,
      y: !usableHorizontal,
    },
  }
}

function spacingResidual(lines: GridCutLine[], expectedCount: number) {
  if (lines.length < 3 || expectedCount < 2) return null
  const first = lines[0].position
  const last = lines.at(-1)?.position ?? first
  const span = last - first
  if (span <= 0) return null

  const expectedStep = span / (expectedCount - 1)
  const errors = lines.map((line) => {
    const projectedIndex = Math.round((line.position - first) / expectedStep)
    const expected = first + projectedIndex * expectedStep
    return Math.abs(line.position - expected)
  })

  return round(errors.reduce((total, value) => total + value, 0) / errors.length)
}

function scoreEvidence({
  fixedRegion,
  horizontal,
  region,
  vertical,
  expectedHorizontal,
  expectedVertical,
  fallback,
  residuals,
}: {
  fixedRegion: ImageRegion
  horizontal: GridCutLine[]
  region: ImageRegion
  vertical: GridCutLine[]
  expectedHorizontal: number
  expectedVertical: number
  fallback: { x: boolean; y: boolean }
  residuals: { x: number | null; y: number | null; max: number | null }
}) {
  const hCoverage = Math.min(1, horizontal.length / expectedHorizontal)
  const vCoverage = Math.min(1, vertical.length / expectedVertical)
  const lineCoverage = hCoverage * 0.62 + vCoverage * 0.38
  const regionDelta = Math.max(
    Math.abs(region.x - fixedRegion.x),
    Math.abs(region.y - fixedRegion.y),
    Math.abs(region.width - fixedRegion.width),
    Math.abs(region.height - fixedRegion.height),
  )
  const fallbackPenalty = (Number(fallback.x) + Number(fallback.y)) * 14
  const residualPenalty = (residuals.max ?? 4) * 7
  const score = clamp(Math.round(lineCoverage * 100 - regionDelta * 4 - fallbackPenalty - residualPenalty), 0, 100)
  const level: GridCutEvidence['level'] =
    score >= 82 && !fallback.x && !fallback.y ? 'good' : score >= 58 ? 'review' : 'calibrate'
  const label = level === 'good' ? '可直接切割' : level === 'review' ? '建议抽查' : '需先校准'
  const reasons: string[] = []

  if (fallback.x) reasons.push('竖线证据不足，列边界回退模板')
  if (fallback.y) reasons.push('横线证据不足，行边界回退模板')
  if (horizontal.length < expectedHorizontal * 0.65) reasons.push('横向格线覆盖不足')
  if (vertical.length < expectedVertical * 0.65) reasons.push('纵向格线覆盖不足')
  if ((residuals.max ?? 0) > 1.8) reasons.push('格线间距残差偏高')
  if (regionDelta > 5) reasons.push('检测外框和固定模板偏差较大')
  if (!reasons.length) reasons.push('横竖线证据稳定，适合本地切格')

  return {
    score,
    level,
    label,
    confidence: round(score / 100, 2),
    reasons,
  }
}

function buildMask(image: LoadedImage) {
  const context = image.canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('当前浏览器不支持 Canvas 图像分析。')
  const imageData = context.getImageData(0, 0, image.width, image.height)
  const grayValues: number[] = []
  const gray = new Uint8ClampedArray(image.width * image.height)

  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    const offset = pixel * 4
    const value = Math.round(
      imageData.data[offset] * 0.299 +
        imageData.data[offset + 1] * 0.587 +
        imageData.data[offset + 2] * 0.114,
    )
    gray[pixel] = value
    if (pixel % 13 === 0) grayValues.push(value)
  }

  const darkCutoff = clamp(percentile(grayValues, 0.28) + 12, 70, 178)
  const mask = new Uint8Array(gray.length)
  let darkPixels = 0
  for (let pixel = 0; pixel < gray.length; pixel += 1) {
    const dark = gray[pixel] <= darkCutoff ? 1 : 0
    mask[pixel] = dark
    darkPixels += dark
  }

  const sampleBand = Math.max(1, Math.round(Math.min(image.width, image.height) * 0.08))
  const bandDensity = (fromX: number, toX: number, fromY: number, toY: number) => {
    let dark = 0
    let total = 0
    for (let y = fromY; y < toY; y += 1) {
      for (let x = fromX; x < toX; x += 1) {
        dark += mask[y * image.width + x]
        total += 1
      }
    }
    return total ? dark / total : 0
  }

  return {
    mask,
    darkRatio: darkPixels / Math.max(mask.length, 1),
    borderDensity: {
      top: bandDensity(0, image.width, 0, sampleBand),
      bottom: bandDensity(0, image.width, Math.max(0, image.height - sampleBand), image.height),
      left: bandDensity(0, sampleBand, 0, image.height),
      right: bandDensity(Math.max(0, image.width - sampleBand), image.width, 0, image.height),
      center: bandDensity(
        Math.round(image.width * 0.25),
        Math.round(image.width * 0.75),
        Math.round(image.height * 0.25),
        Math.round(image.height * 0.75),
      ),
    },
  } satisfies MaskSummary
}

export async function detectLedgerGridFromImage(
  dataUrl: string,
  template: PaperTemplate,
): Promise<GridCutEvidence> {
  const grid = getTemplateGrid(template)
  const fixedRegion = grid.tableRegion
  const expectedHorizontal = grid.rows + grid.headerRows + 1
  const expectedVertical = grid.columns.length + 1
  const image = await loadScaledImage(dataUrl)
  const maskSummary = buildMask(image)
  const axisEvidence = buildAxisEvidence(maskSummary.mask, image.width, image.height)
  const rowThreshold = Math.max(
    0.18,
    percentile(axisEvidence.rows.strengths, 0.9) * 0.78 + percentile(axisEvidence.rows.continuity, 0.82) * 0.22,
  )
  const columnThreshold = Math.max(
    0.16,
    percentile(axisEvidence.columns.strengths, 0.9) * 0.78 +
      percentile(axisEvidence.columns.continuity, 0.82) * 0.22,
  )
  const horizontal = groupPeaks(axisEvidence.rows.strengths, rowThreshold, 3).map((group) =>
    toLine(group, 'y', image.height),
  )
  const vertical = groupPeaks(axisEvidence.columns.strengths, columnThreshold, 3).map((group) =>
    toLine(group, 'x', image.width),
  )
  const cnnHorizontal = detectGridLinesWithCnn(
    {
      strengths: axisEvidence.rows.strengths,
      continuity: axisEvidence.rows.continuity,
      transitions: axisEvidence.rows.transitions,
    },
    'y',
    image.height,
  )
  const cnnVertical = detectGridLinesWithCnn(
    {
      strengths: axisEvidence.columns.strengths,
      continuity: axisEvidence.columns.continuity,
      transitions: axisEvidence.columns.transitions,
    },
    'x',
    image.width,
  )
  const fusedHorizontal = fuseLineCandidates(horizontal, cnnHorizontal.lines)
  const fusedVertical = fuseLineCandidates(vertical, cnnVertical.lines)
  const detected = regionFromLines(fusedHorizontal, fusedVertical, fixedRegion)
  const residuals = {
    x: spacingResidual(fusedVertical, expectedVertical),
    y: spacingResidual(fusedHorizontal, expectedHorizontal),
    max: null as number | null,
  }
  const finiteResiduals = [residuals.x, residuals.y].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )
  residuals.max = finiteResiduals.length ? Math.max(...finiteResiduals) : null

  const scored = scoreEvidence({
    fixedRegion,
    horizontal: fusedHorizontal,
    region: detected.region,
    vertical: fusedVertical,
    expectedHorizontal,
    expectedVertical,
    fallback: detected.fallback,
    residuals,
  })

  const modelPrediction = predictGridCutModel(
    {
      width: image.width,
      height: image.height,
      darkRatio: maskSummary.darkRatio,
      borderDensity: maskSummary.borderDensity,
      rowStrengths: axisEvidence.rows.strengths,
      columnStrengths: axisEvidence.columns.strengths,
      horizontalLines: fusedHorizontal,
      verticalLines: fusedVertical,
      expectedHorizontal,
      expectedVertical,
      residuals: { x: residuals.x, y: residuals.y },
    },
    fixedRegion,
  )
  const blend = clamp(modelPrediction.confidence * (scored.level === 'calibrate' ? 0.55 : 0.32), 0, 0.55)
  const blendedRegion = {
    x: round(detected.region.x * (1 - blend) + modelPrediction.region.x * blend),
    y: round(detected.region.y * (1 - blend) + modelPrediction.region.y * blend),
    width: round(detected.region.width * (1 - blend) + modelPrediction.region.width * blend),
    height: round(detected.region.height * (1 - blend) + modelPrediction.region.height * blend),
  }
  const regionProjectionDelta = Math.max(
    Math.abs(blendedRegion.x - fixedRegion.x),
    Math.abs(blendedRegion.y - fixedRegion.y),
    Math.abs(blendedRegion.width - fixedRegion.width),
    Math.abs(blendedRegion.height - fixedRegion.height),
  )
  const allowHorizontalProjection =
    horizontal.length >= 1 &&
    vertical.length >= Math.max(2, Math.round(expectedVertical * 0.2)) &&
    (modelPrediction.confidence >= 0.42 || scored.score >= 40) &&
    (residuals.x ?? Number.POSITIVE_INFINITY) <= 1.4 &&
    regionProjectionDelta <= 5.2
  const allowVerticalProjection =
    vertical.length >= 1 &&
    (horizontal.length >= Math.max(12, Math.round(expectedHorizontal * 0.42)) ||
      (horizontal.length >= Math.max(8, Math.round(expectedHorizontal * 0.24)) &&
        (residuals.y ?? Number.POSITIVE_INFINITY) <= 0.12 &&
        modelPrediction.confidence >= 0.5)) &&
    (modelPrediction.confidence >= 0.42 || scored.score >= 40) &&
    (residuals.y ?? Number.POSITIVE_INFINITY) <= 1.1 &&
    regionProjectionDelta <= 5.2
  const alignedHorizontal = alignLinesToTemplate(fusedHorizontal, blendedRegion, expectedHorizontal, 'y', {
    allowProjection: allowHorizontalProjection,
  })
  const alignedVertical = alignLinesToTemplate(fusedVertical, blendedRegion, expectedVertical, 'x', {
    allowProjection: allowVerticalProjection,
  })
  const effectiveHorizontalCoverage = templateAssistedCoverage(
    horizontal.length,
    expectedHorizontal,
    alignedHorizontal.matchedCount,
    alignedHorizontal.syntheticCount,
    'y',
  )
  const effectiveVerticalCoverage = templateAssistedCoverage(
    vertical.length,
    expectedVertical,
    alignedVertical.matchedCount,
    alignedVertical.syntheticCount,
    'x',
  )
  const coverageScore = Math.round((effectiveHorizontalCoverage * 0.62 + effectiveVerticalCoverage * 0.38) * 100)
  const rawHorizontalSpan =
    horizontal.length >= 2 ? (horizontal.at(-1)?.position ?? horizontal[0].position) - horizontal[0].position : 0
  const rawVerticalSpan =
    vertical.length >= 2 ? (vertical.at(-1)?.position ?? vertical[0].position) - vertical[0].position : 0
  const fallbackPenalty =
    (detected.fallback.x ? (alignedVertical.syntheticCount ? 4 : 12) : 0) +
    (detected.fallback.y ? (alignedHorizontal.syntheticCount ? 6 : 14) : 0)
  const residualPenalty = Math.round((residuals.max ?? 0) * 5)
  const regionPenalty = Math.round(regionProjectionDelta * 3)
  const adjustedHybridScore = clamp(coverageScore - fallbackPenalty - residualPenalty - regionPenalty, 0, 100)
  const hybridScore = clamp(
    Math.max(
      Math.round(scored.score * (1 - blend * 0.7) + modelPrediction.score * blend * 0.7),
      adjustedHybridScore,
    ),
    0,
    100,
  )
  const templateAssistedStable =
    (alignedHorizontal.syntheticCount > 0 || alignedVertical.syntheticCount > 0) && !detected.fallback.y
  let hybridLevel: GridCutEvidence['level'] = 'calibrate'
  if (hybridScore >= 82 && !detected.fallback.x && !detected.fallback.y) {
    hybridLevel = 'good'
  } else if (hybridScore >= 58 || (hybridScore >= 50 && templateAssistedStable)) {
    hybridLevel = 'review'
  }
  const hybridLabel = hybridLevel === 'good' ? '可直接切割' : hybridLevel === 'review' ? '建议抽查' : '需先校准'
  const reasons = [
    ...scored.reasons,
    `1D CNN 检出 ${cnnHorizontal.lines.length} 横 / ${cnnVertical.lines.length} 竖，阈值 ${cnnHorizontal.threshold.toFixed(2)} / ${cnnVertical.threshold.toFixed(2)}`,
    `本地模型置信度 ${(modelPrediction.confidence * 100).toFixed(0)}%，区域修正 x${modelPrediction.deltas.x} y${modelPrediction.deltas.y} w${modelPrediction.deltas.width} h${modelPrediction.deltas.height}`,
  ]
  if (alignedHorizontal.syntheticCount || alignedVertical.syntheticCount) {
    reasons.push(
      `模板约束补线 ${alignedHorizontal.syntheticCount} 横 / ${alignedVertical.syntheticCount} 竖，用于稳定整页切格`,
    )
  }

  return {
    method: 'cnn-hybrid',
    level: hybridLevel,
    label: hybridLabel,
    score: hybridScore,
    confidence: round(hybridScore / 100, 2),
    tableRegion: blendedRegion,
    fixedRegion,
    lines: {
      horizontal: alignedHorizontal.lines,
      vertical: alignedVertical.lines,
    },
    support: {
      expectedHorizontal,
      expectedVertical,
      detectedHorizontal: horizontal.length,
      detectedVertical: vertical.length,
      rawHorizontalSpan: round(rawHorizontalSpan, 2),
      rawVerticalSpan: round(rawVerticalSpan, 2),
      alignedHorizontalMatched: alignedHorizontal.matchedCount,
      alignedHorizontalSynthetic: alignedHorizontal.syntheticCount,
      alignedVerticalMatched: alignedVertical.matchedCount,
      alignedVerticalSynthetic: alignedVertical.syntheticCount,
      effectiveHorizontalCoverage: round(effectiveHorizontalCoverage, 3),
      effectiveVerticalCoverage: round(effectiveVerticalCoverage, 3),
    },
    residuals,
    fallback: detected.fallback,
    reasons,
  }
}

export function shouldHoldForManualGridReview(gridCut: GridCutEvidence | null | undefined) {
  if (!gridCut) return false
  if (gridCut.level !== 'calibrate') return false
  if (gridCut.score < 30) return true
  if (gridCut.score >= 50) return false
  return gridCut.fallback.x || gridCut.fallback.y
}
