import { GRID_CUT_MODEL, type GridCutLinearModelData } from '../data/gridCutModel'
import type { GridCutLine, ImageRegion } from '../types'

export interface GridCutModelContext {
  width: number
  height: number
  darkRatio: number
  borderDensity: {
    top: number
    bottom: number
    left: number
    right: number
    center: number
  }
  rowStrengths: number[]
  columnStrengths: number[]
  horizontalLines: GridCutLine[]
  verticalLines: GridCutLine[]
  expectedHorizontal: number
  expectedVertical: number
  residuals: {
    x: number | null
    y: number | null
  }
}

export interface GridCutModelPrediction {
  confidence: number
  score: number
  region: ImageRegion
  deltas: {
    x: number
    y: number
    width: number
    height: number
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value))
}

function mean(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0
}

function variance(values: number[]) {
  if (!values.length) return 0
  const avg = mean(values)
  return mean(values.map((value) => (value - avg) ** 2))
}

function max(values: number[]) {
  return values.length ? Math.max(...values) : 0
}

function spacingUniformity(lines: GridCutLine[], expectedCount: number) {
  if (lines.length < 3 || expectedCount < 3) return 0
  const positions = lines.map((line) => line.position).sort((a, b) => a - b)
  const gaps = positions.slice(1).map((position, index) => position - positions[index])
  const avgGap = mean(gaps)
  if (!avgGap) return 0
  const normalizedDeviation = Math.sqrt(variance(gaps)) / avgGap
  const coverage = clamp(lines.length / expectedCount, 0, 1)
  return clamp(1 - normalizedDeviation, 0, 1) * coverage
}

function residualNorm(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return clamp(value / 4, 0, 1)
}

function normalizeFeature(value: number, meanValue: number, scale: number) {
  const safeScale = Math.abs(scale) < 0.0001 ? 1 : scale
  return (value - meanValue) / safeScale
}

function featureVector(context: GridCutModelContext) {
  const rowPeakMean = mean(context.horizontalLines.map((line) => line.strength))
  const colPeakMean = mean(context.verticalLines.map((line) => line.strength))
  const rowPeakMax = max(context.horizontalLines.map((line) => line.strength))
  const colPeakMax = max(context.verticalLines.map((line) => line.strength))
  const rowCoverage = clamp(context.horizontalLines.length / context.expectedHorizontal, 0, 1)
  const colCoverage = clamp(context.verticalLines.length / context.expectedVertical, 0, 1)

  return [
    context.width / Math.max(context.height, 1),
    context.darkRatio,
    context.borderDensity.top,
    context.borderDensity.bottom,
    context.borderDensity.left,
    context.borderDensity.right,
    context.borderDensity.center,
    rowCoverage,
    colCoverage,
    rowPeakMean,
    colPeakMean,
    rowPeakMax,
    colPeakMax,
    residualNorm(context.residuals.y),
    residualNorm(context.residuals.x),
    spacingUniformity(context.horizontalLines, context.expectedHorizontal),
    spacingUniformity(context.verticalLines, context.expectedVertical),
    clamp(mean(context.rowStrengths) / 0.45, 0, 1),
    clamp(mean(context.columnStrengths) / 0.45, 0, 1),
  ]
}

function multiply(model: GridCutLinearModelData, features: number[]) {
  const normalized = features.map((feature, index) =>
    normalizeFeature(feature, model.means[index] ?? 0, model.scales[index] ?? 1),
  )

  return model.weights.map((row, rowIndex) =>
    row.reduce((total, weight, featureIndex) => total + weight * (normalized[featureIndex] ?? 0), model.bias[rowIndex] ?? 0),
  )
}

export function predictGridCutModel(
  context: GridCutModelContext,
  fixedRegion: ImageRegion,
  model: GridCutLinearModelData = GRID_CUT_MODEL,
): GridCutModelPrediction {
  const outputs = multiply(model, featureVector(context))
  const deltas = {
    x: round(clamp(Math.tanh(outputs[0] ?? 0) * 7.5, -10, 10)),
    y: round(clamp(Math.tanh(outputs[1] ?? 0) * 7.5, -10, 10)),
    width: round(clamp(Math.tanh(outputs[2] ?? 0) * 9, -12, 12)),
    height: round(clamp(Math.tanh(outputs[3] ?? 0) * 9, -12, 12)),
  }
  const confidence = round(sigmoid(outputs[4] ?? 0), 3)
  const score = Math.round(confidence * 100)
  const x = clamp(round(fixedRegion.x + deltas.x), 0, 99)
  const y = clamp(round(fixedRegion.y + deltas.y), 0, 99)
  const width = clamp(round(fixedRegion.width + deltas.width), 1, 100 - x)
  const height = clamp(round(fixedRegion.height + deltas.height), 1, 100 - y)

  return {
    confidence,
    score,
    region: { x, y, width, height },
    deltas,
  }
}
