import {
  PAGE_COMPLETENESS_MODEL,
  type PageCompletenessModelData,
} from '../data/pageCompletenessModel'
import type { GridCutEvidence } from '../types'

export interface PageCompletenessContext {
  gridCut: GridCutEvidence
  meanCutConfidence: number
  lowCutRatio: number
  ocrCriticalLowCutRatio: number
  reviewRatio: number
  calibrateRatio: number
}

export interface PageCompletenessPrediction {
  completeProbability: number
  incompleteProbability: number
  isLikelyComplete: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value))
}

function normalizeFeature(value: number, meanValue: number, scale: number) {
  const safeScale = Math.abs(scale) < 0.0001 ? 1 : scale
  return (value - meanValue) / safeScale
}

function featureVector(context: PageCompletenessContext) {
  const { gridCut } = context
  return [
    gridCut.score / 100,
    gridCut.confidence,
    gridCut.support.detectedHorizontal / Math.max(gridCut.support.expectedHorizontal, 1),
    gridCut.support.detectedVertical / Math.max(gridCut.support.expectedVertical, 1),
    (gridCut.support.rawHorizontalSpan ?? 0) / 100,
    (gridCut.support.rawVerticalSpan ?? 0) / 100,
    (gridCut.support.alignedHorizontalMatched ?? 0) / Math.max(gridCut.support.expectedHorizontal, 1),
    (gridCut.support.alignedHorizontalSynthetic ?? 0) / Math.max(gridCut.support.expectedHorizontal, 1),
    (gridCut.support.alignedVerticalMatched ?? 0) / Math.max(gridCut.support.expectedVertical, 1),
    (gridCut.support.alignedVerticalSynthetic ?? 0) / Math.max(gridCut.support.expectedVertical, 1),
    gridCut.support.effectiveHorizontalCoverage ?? 0,
    gridCut.support.effectiveVerticalCoverage ?? 0,
    gridCut.fallback.x ? 1 : 0,
    gridCut.fallback.y ? 1 : 0,
    context.meanCutConfidence,
    context.lowCutRatio,
    context.ocrCriticalLowCutRatio,
    context.reviewRatio,
    context.calibrateRatio,
  ]
}

export function predictPageCompleteness(
  context: PageCompletenessContext,
  model: PageCompletenessModelData = PAGE_COMPLETENESS_MODEL,
): PageCompletenessPrediction {
  const features = featureVector(context)
  const normalized = features.map((feature, index) =>
    normalizeFeature(feature, model.means[index] ?? 0, model.scales[index] ?? 1),
  )
  let logit = model.bias
  for (let index = 0; index < normalized.length; index += 1) {
    logit += normalized[index] * (model.weights[index] ?? 0)
  }
  const completeProbability = clamp(round(sigmoid(logit)), 0, 1)
  return {
    completeProbability,
    incompleteProbability: round(1 - completeProbability),
    isLikelyComplete: completeProbability >= model.completeThreshold,
  }
}
