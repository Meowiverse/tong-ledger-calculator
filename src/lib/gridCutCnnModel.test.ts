import { describe, expect, it } from 'vitest'
import { detectGridLinesWithCnn, predictGridLineProbabilities } from './gridCutCnnModel'

describe('grid cut cnn model', () => {
  it('scores true grid-like peaks above nearby noise', () => {
    const strengths = Array.from({ length: 48 }, () => 0.08)
    const continuity = Array.from({ length: 48 }, () => 0.08)
    const transitions = Array.from({ length: 48 }, () => 0.74)

    for (const center of [5, 15, 27, 40]) {
      for (let offset = -2; offset <= 2; offset += 1) {
        const index = center + offset
        if (index < 0 || index >= strengths.length) continue
        const closeness = Math.max(0, 1 - Math.abs(offset) / 2.6)
        strengths[index] = Math.min(1, strengths[index] + closeness * 0.76)
        continuity[index] = Math.min(1, continuity[index] + closeness * 0.82)
        transitions[index] = Math.max(0, transitions[index] - closeness * 0.58)
      }
    }

    for (const center of [11, 34]) {
      strengths[center] = 0.66
      continuity[center] = 0.12
      transitions[center] = 0.92
    }

    const probabilities = predictGridLineProbabilities({ strengths, continuity, transitions })

    expect(probabilities[15]).toBeGreaterThan(probabilities[11])
    expect(probabilities[27]).toBeGreaterThan(probabilities[34])
    expect(probabilities[40]).toBeGreaterThan(0.6)
  })

  it('detects multiple grid lines from the local cnn probabilities', () => {
    const strengths = Array.from({ length: 64 }, () => 0.07)
    const continuity = Array.from({ length: 64 }, () => 0.06)
    const transitions = Array.from({ length: 64 }, () => 0.72)

    for (const center of [6, 19, 33, 46, 58]) {
      for (let offset = -2; offset <= 2; offset += 1) {
        const index = center + offset
        if (index < 0 || index >= strengths.length) continue
        const closeness = Math.max(0, 1 - Math.abs(offset) / 2.8)
        strengths[index] = Math.min(1, strengths[index] + closeness * 0.74)
        continuity[index] = Math.min(1, continuity[index] + closeness * 0.79)
        transitions[index] = Math.max(0, transitions[index] - closeness * 0.54)
      }
    }

    const detected = detectGridLinesWithCnn({ strengths, continuity, transitions }, 'y', 64)
    expect(detected.lines.length).toBeGreaterThanOrEqual(5)
    expect(detected.lines[0]?.position ?? 0).toBeGreaterThanOrEqual(5)
    expect(detected.lines.at(-1)?.position ?? 100).toBeLessThanOrEqual(95)
  })
})
