import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FEATURE_NAMES = [
  'gridScore',
  'gridConfidence',
  'rawHorizontalCoverage',
  'rawVerticalCoverage',
  'rawHorizontalSpanNorm',
  'rawVerticalSpanNorm',
  'alignedHorizontalMatchNorm',
  'alignedHorizontalSyntheticNorm',
  'alignedVerticalMatchNorm',
  'alignedVerticalSyntheticNorm',
  'effectiveHorizontalCoverage',
  'effectiveVerticalCoverage',
  'fallbackX',
  'fallbackY',
  'meanCutConfidence',
  'lowCutRatio',
  'ocrCriticalLowCutRatio',
  'reviewRatio',
  'calibrateRatio',
]

function readArg(name, fallback) {
  const prefix = `--${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function round(value, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value))
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1)
}

function std(values, avg) {
  const variance = values.reduce((total, value) => total + (value - avg) ** 2, 0) / Math.max(values.length, 1)
  return Math.sqrt(variance) || 1
}

function featureRow(item) {
  const reviewRatio = item.reviewableCellCount
    ? (item.cutLevels?.review || 0) / item.reviewableCellCount
    : 0
  const calibrateRatio = item.reviewableCellCount
    ? (item.cutLevels?.calibrate || 0) / item.reviewableCellCount
    : 0

  return [
    (item.score || 0) / 100,
    item.confidence || 0,
    (item.detectedHorizontal || 0) / Math.max(item.expectedHorizontal || 1, 1),
    (item.detectedVertical || 0) / Math.max(item.expectedVertical || 1, 1),
    (item.rawHorizontalSpan || 0) / 100,
    (item.rawVerticalSpan || 0) / 100,
    (item.alignedHorizontalMatched || 0) / Math.max(item.expectedHorizontal || 1, 1),
    (item.alignedHorizontalSynthetic || 0) / Math.max(item.expectedHorizontal || 1, 1),
    (item.alignedVerticalMatched || 0) / Math.max(item.expectedVertical || 1, 1),
    (item.alignedVerticalSynthetic || 0) / Math.max(item.expectedVertical || 1, 1),
    item.effectiveHorizontalCoverage || 0,
    item.effectiveVerticalCoverage || 0,
    item.fallbackX ? 1 : 0,
    item.fallbackY ? 1 : 0,
    item.meanCutConfidence || 0,
    item.lowCutRatio || 0,
    item.ocrCriticalLowCutRatio || 0,
    reviewRatio,
    calibrateRatio,
  ]
}

function standardize(rows) {
  const means = Array.from({ length: FEATURE_NAMES.length }, (_, index) => mean(rows.map((row) => row[index])))
  const scales = Array.from({ length: FEATURE_NAMES.length }, (_, index) => std(rows.map((row) => row[index]), means[index]))
  return {
    means,
    scales,
    rows: rows.map((row) => row.map((value, index) => (value - means[index]) / scales[index])),
  }
}

function trainLogisticRegression(rows, labels) {
  const weights = Array.from({ length: FEATURE_NAMES.length }, () => 0)
  let bias = 0
  const epochs = 4000
  const learningRate = 0.14
  const regularization = 0.002

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradient = Array.from({ length: FEATURE_NAMES.length }, () => 0)
    let biasGradient = 0
    const step = learningRate * (1 - epoch / epochs * 0.45)

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]
      const label = labels[rowIndex]
      let logit = bias
      for (let index = 0; index < row.length; index += 1) logit += row[index] * weights[index]
      const probability = sigmoid(logit)
      const error = probability - label
      biasGradient += error
      for (let index = 0; index < row.length; index += 1) gradient[index] += error * row[index]
    }

    for (let index = 0; index < weights.length; index += 1) {
      const grad = gradient[index] / rows.length + weights[index] * regularization
      weights[index] -= step * grad
    }
    bias -= step * (biasGradient / rows.length)
  }

  return { weights, bias }
}

function predictRows(rows, model) {
  return rows.map((row) => {
    let logit = model.bias
    for (let index = 0; index < row.length; index += 1) logit += row[index] * model.weights[index]
    return sigmoid(logit)
  })
}

function pickThreshold(probabilities, labels) {
  let best = null
  for (let threshold = 0.35; threshold <= 0.85; threshold += 0.01) {
    let trueComplete = 0
    let falseComplete = 0
    let missedComplete = 0

    for (let index = 0; index < probabilities.length; index += 1) {
      const predictedComplete = probabilities[index] >= threshold
      const actualComplete = labels[index] === 1
      if (predictedComplete && actualComplete) trueComplete += 1
      else if (predictedComplete) falseComplete += 1
      else if (actualComplete) missedComplete += 1
    }

    const accuracy =
      probabilities.filter((_, index) => (probabilities[index] >= threshold) === (labels[index] === 1)).length /
      probabilities.length
    const candidate = {
      threshold: round(threshold, 3),
      falseComplete,
      trueComplete,
      missedComplete,
      accuracy,
    }

    if (
      !best ||
      candidate.falseComplete < best.falseComplete ||
      (candidate.falseComplete === best.falseComplete && candidate.trueComplete > best.trueComplete) ||
      (candidate.falseComplete === best.falseComplete &&
        candidate.trueComplete === best.trueComplete &&
        candidate.accuracy > best.accuracy)
    ) {
      best = candidate
    }
  }

  return best
}

function renderTsModule(model) {
  return `export interface PageCompletenessModelData {
  version: string
  featureNames: string[]
  means: number[]
  scales: number[]
  weights: number[]
  bias: number
  completeThreshold: number
}

export const PAGE_COMPLETENESS_MODEL: PageCompletenessModelData = ${JSON.stringify(model, null, 2)}
`
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const inputPath = path.resolve(
  readArg('input', path.join(repoRoot, 'reports', 'gridcut-benchmark', 'downloads-readiness-20260626-diagnostics.json')),
)
const outputPath = path.resolve(readArg('output', path.join(repoRoot, 'src', 'data', 'pageCompletenessModel.ts')))

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
const items = Array.isArray(raw.items) ? raw.items : []
if (!items.length) throw new Error(`No benchmark items found in ${inputPath}`)

const rows = items.map(featureRow)
const labels = items.map((item) => (item.pageBucket === 'complete-page-candidate' ? 1 : 0))
const standardized = standardize(rows)
const trained = trainLogisticRegression(standardized.rows, labels)
const probabilities = predictRows(standardized.rows, trained)
const threshold = pickThreshold(probabilities, labels)

const model = {
  version: 'page-completeness-logreg-v1-downloads-20260626',
  featureNames: FEATURE_NAMES,
  means: standardized.means.map((value) => round(value)),
  scales: standardized.scales.map((value) => round(value)),
  weights: trained.weights.map((value) => round(value)),
  bias: round(trained.bias),
  completeThreshold: threshold.threshold,
}

fs.writeFileSync(outputPath, renderTsModule(model))
console.log(
  JSON.stringify(
    {
      inputPath,
      outputPath,
      version: model.version,
      sampleCount: items.length,
      threshold,
    },
    null,
    2,
  ),
)
