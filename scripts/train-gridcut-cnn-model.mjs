import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LENGTH = 96
const KERNEL_SIZE = 7
const FEATURE_COUNT = KERNEL_SIZE * 3
const TRAIN_SEQUENCE_COUNT = 360
const VALIDATION_SEQUENCE_COUNT = 120
const EPOCHS = 220
const LEARNING_RATE = 0.045
const REGULARIZATION = 0.0008

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

function mulberry32(seed) {
  return function rand() {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function createSequence(rand) {
  const lineCount = 8 + Math.floor(rand() * 28)
  const first = 3 + rand() * 6
  const last = LENGTH - 4 - rand() * 4
  const step = (last - first) / Math.max(lineCount - 1, 1)
  const strengths = Array.from({ length: LENGTH }, () => 0.02 + rand() * 0.06)
  const continuity = Array.from({ length: LENGTH }, () => 0.03 + rand() * 0.05)
  const transitions = Array.from({ length: LENGTH }, () => 0.22 + rand() * 0.18)
  const labels = Array.from({ length: LENGTH }, () => 0)

  const centers = Array.from({ length: lineCount }, (_, index) =>
    clamp(Math.round(first + step * index + (rand() * 2 - 1) * 0.85), 0, LENGTH - 1),
  )

  for (const center of centers) {
    const strong = 0.64 + rand() * 0.3
    const stable = 0.62 + rand() * 0.28
    const brokenPenalty = rand() < 0.18 ? 0.16 + rand() * 0.16 : 0
    for (let offset = -3; offset <= 3; offset += 1) {
      const index = center + offset
      if (index < 0 || index >= LENGTH) continue
      const closeness = clamp(1 - Math.abs(offset) / 3.4, 0, 1)
      strengths[index] = clamp(strengths[index] + strong * closeness, 0, 1)
      continuity[index] = clamp(continuity[index] + (stable - brokenPenalty) * closeness, 0, 1)
      transitions[index] = clamp(transitions[index] - (0.22 + rand() * 0.18) * closeness, 0, 1)
      labels[index] = Math.max(labels[index], offset === 0 ? 1 : closeness * 0.72)
    }
  }

  const noiseStrokes = 4 + Math.floor(rand() * 10)
  for (let stroke = 0; stroke < noiseStrokes; stroke += 1) {
    const center = Math.floor(rand() * LENGTH)
    const width = 1 + Math.floor(rand() * 3)
    const bold = 0.24 + rand() * 0.28
    for (let offset = -width; offset <= width; offset += 1) {
      const index = center + offset
      if (index < 0 || index >= LENGTH) continue
      const closeness = clamp(1 - Math.abs(offset) / Math.max(width + 0.3, 1), 0, 1)
      strengths[index] = clamp(strengths[index] + bold * closeness, 0, 1)
      continuity[index] = clamp(continuity[index] + (0.05 + rand() * 0.12) * closeness, 0, 1)
      transitions[index] = clamp(transitions[index] + (0.18 + rand() * 0.25) * closeness, 0, 1)
    }
  }

  for (let index = 0; index < LENGTH; index += 1) {
    if (rand() < 0.09) transitions[index] = clamp(transitions[index] + rand() * 0.35, 0, 1)
    if (rand() < 0.06) continuity[index] = clamp(continuity[index] - rand() * 0.2, 0, 1)
  }

  return { strengths, continuity, transitions, labels }
}

function extractWindow(channel, index, radius) {
  const values = []
  for (let offset = -radius; offset <= radius; offset += 1) {
    const sourceIndex = clamp(index + offset, 0, channel.length - 1)
    values.push(channel[sourceIndex] ?? 0)
  }
  return values
}

function buildDataset(rand, sequenceCount) {
  const radius = Math.floor(KERNEL_SIZE / 2)
  const rows = []
  const labels = []

  for (let sequenceIndex = 0; sequenceIndex < sequenceCount; sequenceIndex += 1) {
    const sample = createSequence(rand)
    const stability = sample.transitions.map((value) => clamp(1 - value, 0, 1))

    for (let index = 0; index < LENGTH; index += 1) {
      rows.push([
        ...extractWindow(sample.strengths, index, radius),
        ...extractWindow(sample.continuity, index, radius),
        ...extractWindow(stability, index, radius),
      ])
      labels.push(sample.labels[index])
    }
  }

  return { rows, labels }
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1)
}

function std(values, avg) {
  const variance = values.reduce((total, value) => total + (value - avg) ** 2, 0) / Math.max(values.length, 1)
  return Math.sqrt(variance) || 1
}

function standardize(rows) {
  const means = Array.from({ length: FEATURE_COUNT }, (_, index) => mean(rows.map((row) => row[index])))
  const scales = Array.from({ length: FEATURE_COUNT }, (_, index) => std(rows.map((row) => row[index]), means[index]))
  return {
    means,
    scales,
    rows: rows.map((row) => row.map((value, index) => (value - means[index]) / scales[index])),
  }
}

function trainLogisticRegression(rows, labels) {
  const weights = Array.from({ length: FEATURE_COUNT }, () => 0)
  let bias = 0

  for (let epoch = 0; epoch < EPOCHS; epoch += 1) {
    const learningRate = LEARNING_RATE * (1 - epoch / EPOCHS * 0.38)
    const gradient = Array.from({ length: FEATURE_COUNT }, () => 0)
    let biasGradient = 0

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]
      const label = labels[rowIndex]
      let logit = bias
      for (let index = 0; index < FEATURE_COUNT; index += 1) logit += row[index] * weights[index]
      const probability = sigmoid(logit)
      const error = probability - label
      biasGradient += error
      for (let index = 0; index < FEATURE_COUNT; index += 1) gradient[index] += error * row[index]
    }

    for (let index = 0; index < FEATURE_COUNT; index += 1) {
      const grad = gradient[index] / rows.length + weights[index] * REGULARIZATION
      weights[index] -= learningRate * grad
    }
    bias -= learningRate * (biasGradient / rows.length)
  }

  return { weights, bias }
}

function predictRows(rows, model) {
  return rows.map((row) => {
    let logit = model.bias
    for (let index = 0; index < FEATURE_COUNT; index += 1) logit += row[index] * model.weights[index]
    return sigmoid(logit)
  })
}

function bestThreshold(probabilities, labels) {
  let best = { threshold: 0.5, score: -1 }
  for (let threshold = 0.35; threshold <= 0.78; threshold += 0.01) {
    let tp = 0
    let fp = 0
    let fn = 0
    for (let index = 0; index < probabilities.length; index += 1) {
      const predicted = probabilities[index] >= threshold
      const actual = labels[index] >= 0.65
      if (predicted && actual) tp += 1
      else if (predicted) fp += 1
      else if (actual) fn += 1
    }
    const precision = tp / Math.max(tp + fp, 1)
    const recall = tp / Math.max(tp + fn, 1)
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0
    if (f1 > best.score) best = { threshold: round(threshold, 3), score: f1 }
  }
  return best.threshold
}

function renderTsModule(model) {
  return `export interface GridCutCnnModelData {
  version: string
  kernelSize: number
  means: number[]
  scales: number[]
  weights: number[]
  bias: number
  threshold: number
}

export const GRID_CUT_CNN_MODEL: GridCutCnnModelData = ${JSON.stringify(model, null, 2)}
`
}

const trainRand = mulberry32(20260626)
const validRand = mulberry32(20260627)
const training = buildDataset(trainRand, TRAIN_SEQUENCE_COUNT)
const validation = buildDataset(validRand, VALIDATION_SEQUENCE_COUNT)
const standardizedTraining = standardize(training.rows)
const standardizedValidation = validation.rows.map((row) =>
  row.map((value, index) => (value - standardizedTraining.means[index]) / standardizedTraining.scales[index]),
)
const trained = trainLogisticRegression(standardizedTraining.rows, training.labels)
const threshold = bestThreshold(predictRows(standardizedValidation, trained), validation.labels)

const model = {
  version: 'grid-cut-cnn-v1-synthetic',
  kernelSize: KERNEL_SIZE,
  means: standardizedTraining.means.map((value) => round(value)),
  scales: standardizedTraining.scales.map((value) => round(value)),
  weights: trained.weights.map((value) => round(value)),
  bias: round(trained.bias),
  threshold,
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = path.join(repoRoot, 'src', 'data', 'gridCutCnnModel.ts')
writeFileSync(outputPath, renderTsModule(model))
console.log(JSON.stringify({ outputPath, version: model.version, threshold }, null, 2))
