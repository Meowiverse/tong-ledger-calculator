import { describe, expect, it } from 'vitest'
import { shouldHoldForManualGridReview } from './gridCut'
import type { GridCutEvidence } from '../types'

function makeGridCut(patch: Partial<GridCutEvidence>): GridCutEvidence {
  return {
    method: 'cnn-hybrid',
    level: 'calibrate',
    label: '需先校准',
    score: 32,
    confidence: 0.32,
    tableRegion: { x: 9.2, y: 5.6, width: 74, height: 94.1 },
    fixedRegion: { x: 9.2, y: 5.6, width: 74, height: 94.1 },
    lines: { horizontal: [], vertical: [] },
    support: {
      expectedHorizontal: 33,
      expectedVertical: 10,
      detectedHorizontal: 6,
      detectedVertical: 1,
    },
    residuals: { x: 2.6, y: 1.8, max: 2.6 },
    fallback: { x: true, y: false },
    reasons: ['竖线证据不足'],
    ...patch,
  }
}

describe('grid cut preflight', () => {
  it('holds obviously weak pages for manual review before OCR', () => {
    expect(shouldHoldForManualGridReview(makeGridCut({}))).toBe(true)
  })

  it('also holds very low-score calibrate pages even when fallback flags are false', () => {
    expect(
      shouldHoldForManualGridReview(
        makeGridCut({
          score: 16,
          confidence: 0.16,
          fallback: { x: false, y: false },
          reasons: ['横向格线覆盖不足', '纵向格线覆盖不足'],
        }),
      ),
    ).toBe(true)
  })

  it('does not hold review-level pages that are usable with spot checks', () => {
    expect(
      shouldHoldForManualGridReview(
        makeGridCut({
          level: 'review',
          label: '建议抽查',
          score: 52,
          confidence: 0.52,
          fallback: { x: true, y: false },
        }),
      ),
    ).toBe(false)
  })
})
