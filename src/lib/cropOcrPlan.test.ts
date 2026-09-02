import { describe, expect, it } from 'vitest'
import { SAMPLE_RECOGNITION } from '../data/sampleRecognition'
import { buildCropOcrPlan } from './cropOcrPlan'
import { normalizeResultCells } from './ledgerCells'
import { DEFAULT_PAPER_TEMPLATE } from './paperTemplates'

describe('crop OCR plan', () => {
  it('builds a crop-first OCR plan that recommends only a subset of reviewable cells', () => {
    const result = normalizeResultCells(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE)
    const plan = buildCropOcrPlan(result, DEFAULT_PAPER_TEMPLATE)

    expect(plan.strategy).toBe('page-plus-priority-crops')
    expect(plan.pageImageCount).toBe(1)
    expect(plan.reviewableCellCount).toBe(31 * 7)
    expect(plan.recommendedCropCount).toBeGreaterThan(0)
    expect(plan.recommendedCropCount).toBeLessThan(plan.reviewableCellCount)
    expect(plan.estimatedSavingsRatio).toBeGreaterThan(0)
    expect(plan.tokenBudgetLabel).toContain('整页 1 张')
    expect(plan.tasks[0]?.region).toBeTruthy()
    expect(plan.tasks[0]?.cropRef).toContain('cell:r')
    expect(plan.tasks[0]?.score).toBeGreaterThanOrEqual(plan.tasks.at(-1)?.score ?? 0)
  })

  it('prioritizes missed-digit and cut-risk blanks over stable cells', () => {
    const result = normalizeResultCells(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE)
    const plan = buildCropOcrPlan(result, DEFAULT_PAPER_TEMPLATE)

    const blankRisk = plan.tasks.find((task) => task.cellId === 'r1-paper-1')
    const stableAmount = plan.tasks.find((task) => task.cellId === 'r5-paper-2')

    expect(blankRisk?.shouldSend).toBe(true)
    expect(blankRisk?.reasons.join(' ')).toContain('空白格疑似漏字')
    expect((blankRisk?.score ?? 0) >= (stableAmount?.score ?? 0)).toBe(true)
  })
})
