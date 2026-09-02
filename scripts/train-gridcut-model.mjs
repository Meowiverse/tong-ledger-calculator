import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FEATURE_NAMES = [
  'aspectRatio',
  'darkRatio',
  'topBorderDensity',
  'bottomBorderDensity',
  'leftBorderDensity',
  'rightBorderDensity',
  'centerDensity',
  'rowPeakCountNorm',
  'colPeakCountNorm',
  'rowPeakMean',
  'colPeakMean',
  'rowPeakMax',
  'colPeakMax',
  'rowResidualNorm',
  'colResidualNorm',
  'rowSpacingUniformity',
  'colSpacingUniformity',
  'rowCoverage',
  'colCoverage',
]

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function round(value, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function mulberry32(seed) {
  return function rand() {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function jitter(rand, amount) {
  return (rand() * 2 - 1) * amount
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length
}

function std(values, avg) {
  const variance = values.reduce((total, value) => total + (value - avg) ** 2, 0) / values.length
  return Math.sqrt(variance) || 1
}

function generateSample(rand) {
  const portrait = rand() > 0.18
  const aspectRatio = portrait ? 0.74 + jitter(rand, 0.07) : 1.31 + jitter(rand, 0.09)
  const rowCoverage = clamp(0.35 + rand() * 0.7, 0, 1)
  const colCoverage = clamp(0.28 + rand() * 0.72, 0, 1)
  const rowUniformity = clamp(0.2 + rand() * 0.8, 0, 1)
  const colUniformity = clamp(0.2 + rand() * 0.8, 0, 1)
  const rowResidualNorm = clamp(1 - rowUniformity + rand() * 0.15, 0, 1)
  const colResidualNorm = clamp(1 - colUniformity + rand() * 0.15, 0, 1)
  const darkRatio = clamp(0.08 + rowCoverage * 0.11 + colCoverage * 0.06 + jitter(rand, 0.03), 0.04, 0.42)
  const topBorderDensity = clamp(0.16 + rowCoverage * 0.18 + jitter(rand, 0.06), 0, 0.75)
  const bottomBorderDensity = clamp(0.16 + rowCoverage * 0.2 + jitter(rand, 0.06), 0, 0.8)
  const leftBorderDensity = clamp(0.18 + colCoverage * 0.18 + jitter(rand, 0.06), 0, 0.8)
  const rightBorderDensity = clamp(0.18 + colCoverage * 0.2 + jitter(rand, 0.06), 0, 0.82)
  const centerDensity = clamp(0.11 + darkRatio * 0.55 + jitter(rand, 0.04), 0.04, 0.48)
  const rowPeakMean = clamp(0.08 + rowCoverage * 0.28 + jitter(rand, 0.05), 0, 0.7)
  const colPeakMean = clamp(0.08 + colCoverage * 0.26 + jitter(rand, 0.05), 0, 0.7)
  const rowPeakMax = clamp(rowPeakMean + 0.07 + rand() * 0.16, 0, 1)
  const colPeakMax = clamp(colPeakMean + 0.06 + rand() * 0.15, 0, 1)

  const dx = clamp((rightBorderDensity - leftBorderDensity) * 11 + jitter(rand, 2.1), -8.5, 8.5)
  const dy = clamp((bottomBorderDensity - topBorderDensity) * 12 + jitter(rand, 2.4), -8.5, 8.5)
  const dw = clamp((colCoverage - 0.62) * 16 + (colUniformity - 0.6) * 5 + jitter(rand, 2.2), -10.5, 10.5)
  const dh = clamp((rowCoverage - 0.72) * 14 + (rowUniformity - 0.64) * 5 + jitter(rand, 2.4), -10.5, 10.5)
  const confidence = clamp(
    0.1 +
      rowCoverage * 0.28 +
      colCoverage * 0.22 +
      rowUniformity * 0.18 +
      colUniformity * 0.15 +
      rowPeakMean * 0.07 +
      colPeakMean * 0.07 -
      rowResidualNorm * 0.08 -
      colResidualNorm * 0.08 +
      jitter(rand, 0.03),
    0,
    1,
  )

  return {
    features: [
      aspectRatio,
      darkRatio,
      topBorderDensity,
      bottomBorderDensity,
      leftBorderDensity,
      rightBorderDensity,
      centerDensity,
      rowCoverage,
      colCoverage,
      rowPeakMean,
      colPeakMean,
      rowPeakMax,
      colPeakMax,
      rowResidualNorm,
      colResidualNorm,
      rowUniformity,
      colUniformity,
      clamp(rowPeakMean / 0.4 + jitter(rand, 0.03), 0, 1),
      clamp(colPeakMean / 0.4 + jitter(rand, 0.03), 0, 1),
    ],
    targets: [dx, dy, dw, dh, confidence],
  }
}

function transpose(matrix) {
  return matrix[0].map((_, columnIndex) => matrix.map((row) => row[columnIndex]))
}

function matMul(a, b) {
  return a.map((row) =>
    b[0].map((_, columnIndex) =>
      row.reduce((total, value, index) => total + value * b[index][columnIndex], 0),
    ),
  )
}

function invert(matrix) {
  const size = matrix.length
  const augmented = matrix.map((row, rowIndex) => [
    ...row.map((value) => value),
    ...Array.from({ length: size }, (_, index) => (index === rowIndex ? 1 : 0)),
  ])

  for (let pivot = 0; pivot < size; pivot += 1) {
    let maxRow = pivot
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) maxRow = row
    }
    ;[augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]]
    const pivotValue = augmented[pivot][pivot] || 1e-9
    for (let column = 0; column < size * 2; column += 1) augmented[pivot][column] /= pivotValue
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue
      const factor = augmented[row][pivot]
      for (let column = 0; column < size * 2; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column]
      }
    }
  }

  return augmented.map((row) => row.slice(size))
}

function trainLinearModel(samples) {
  const features = FEATURE_NAMES.length
  const outputs = 5
  const xs = samples.map((sample) => sample.features)
  const ys = samples.map((sample) => sample.targets)
  const means = Array.from({ length: features }, (_, index) => mean(xs.map((row) => row[index])))
  const scales = Array.from({ length: features }, (_, index) => std(xs.map((row) => row[index]), means[index]))
  const standardized = xs.map((row) => row.map((value, index) => (value - means[index]) / scales[index]))
  const design = standardized.map((row) => [...row, 1])
  const xt = transpose(design)
  const xtx = matMul(xt, design)
  const lambda = 0.08
  for (let index = 0; index < xtx.length; index += 1) xtx[index][index] += lambda
  const inverse = invert(xtx)
  const xty = matMul(xt, ys)
  const solved = matMul(inverse, xty)

  const weights = Array.from({ length: outputs }, (_, outputIndex) =>
    Array.from({ length: features }, (_, featureIndex) => round(solved[featureIndex][outputIndex])),
  )
  const bias = Array.from({ length: outputs }, (_, outputIndex) => round(solved[features][outputIndex]))
  return { means: means.map((value) => round(value)), scales: scales.map((value) => round(value)), weights, bias }
}

function renderTsModule(model) {
  return `export interface GridCutLinearModelData {
  version: string
  featureNames: string[]
  means: number[]
  scales: number[]
  weights: number[][]
  bias: number[]
}

export const GRID_CUT_MODEL: GridCutLinearModelData = ${JSON.stringify(model, null, 2)}
`
}

const rand = mulberry32(20260625)
const sampleCount = 3200
const samples = Array.from({ length: sampleCount }, () => generateSample(rand))
const trained = trainLinearModel(samples)
const model = {
  version: 'grid-cut-linear-v1-synthetic',
  featureNames: FEATURE_NAMES,
  ...trained,
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = path.join(repoRoot, 'src', 'data', 'gridCutModel.ts')
writeFileSync(outputPath, renderTsModule(model))
console.log(JSON.stringify({ outputPath, version: model.version, sampleCount }, null, 2))
