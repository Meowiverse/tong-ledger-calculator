import { GRID_CUT_CNN_MODEL, type GridCutCnnModelData } from '../data/gridCutCnnModel'
import type { GridCutLine } from '../types'

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

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[clamp(Math.floor(sorted.length * ratio), 0, sorted.length - 1)]
}

export interface GridCutCnnAxisInput {
  strengths: number[]
  continuity: number[]
  transitions: number[]
}

export function predictGridLineProbabilities(
  input: GridCutCnnAxisInput,
  model: GridCutCnnModelData = GRID_CUT_CNN_MODEL,
) {
  const length = Math.min(input.strengths.length, input.continuity.length, input.transitions.length)
  const radius = Math.floor(model.kernelSize / 2)
  const stability = input.transitions.slice(0, length).map((value) => clamp(1 - value, 0, 1))
  const channels = [input.strengths.slice(0, length), input.continuity.slice(0, length), stability]

  return Array.from({ length }, (_, index) => {
    let logit = model.bias
    let featureIndex = 0
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sourceIndex = clamp(index + offset, 0, length - 1)
        const raw = channels[channelIndex][sourceIndex] ?? 0
        const normalized = (raw - (model.means[featureIndex] ?? 0)) / (model.scales[featureIndex] ?? 1)
        logit += normalized * (model.weights[featureIndex] ?? 0)
        featureIndex += 1
      }
    }
    return sigmoid(logit)
  })
}

export function detectGridLinesWithCnn(
  input: GridCutCnnAxisInput,
  axis: 'x' | 'y',
  size: number,
  model: GridCutCnnModelData = GRID_CUT_CNN_MODEL,
) {
  const probabilities = predictGridLineProbabilities(input, model)
  const threshold = Math.max(model.threshold, percentile(probabilities, 0.86) * 0.92)
  const lines: GridCutLine[] = []

  let start = -1
  let bestProbability = 0
  let weightedPosition = 0
  let weightedTotal = 0
  for (let index = 0; index < probabilities.length; index += 1) {
    const probability = probabilities[index]
    if (probability >= threshold) {
      if (start < 0) {
        start = index
        bestProbability = probability
        weightedPosition = 0
        weightedTotal = 0
      }
      bestProbability = Math.max(bestProbability, probability)
      weightedPosition += probability * index
      weightedTotal += probability
      continue
    }

    if (start >= 0) {
      const centerIndex = weightedTotal ? weightedPosition / weightedTotal : start
      lines.push({
        axis,
        position: round((centerIndex / Math.max(probabilities.length - 1, 1)) * 100, 2),
        strength: round(bestProbability, 3),
      })
      start = -1
    }
  }

  if (start >= 0) {
    const centerIndex = weightedTotal ? weightedPosition / weightedTotal : start
    lines.push({
      axis,
      position: round((centerIndex / Math.max(probabilities.length - 1, 1)) * 100, 2),
      strength: round(bestProbability, 3),
    })
  }

  return {
    probabilities,
    lines: lines.filter((line) => Number.isFinite(line.position) && line.position >= 0 && line.position <= 100),
    threshold,
    size,
  }
}
