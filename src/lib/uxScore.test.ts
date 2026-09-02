import { describe, expect, it } from 'vitest'
import { SAMPLE_RECOGNITION } from '../data/sampleRecognition'
import { normalizeResultCells } from './ledgerCells'
import { DEFAULT_PAPER_TEMPLATE } from './paperTemplates'
import { evaluateMobileAuditUx } from './uxScore'

describe('mobile audit UX scoring', () => {
  it('scores the fixed-grid sample as S level when evidence and review flow are present', () => {
    const result = normalizeResultCells(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE)
    const evaluation = evaluateMobileAuditUx(result)

    expect(evaluation.grade).toBe('S')
    expect(evaluation.score).toBe(100)
    expect(evaluation.criteria.every((criterion) => criterion.passed)).toBe(true)
  })

  it('does not score local cutting preview as S until cutting is reliable', () => {
    const result = normalizeResultCells(
      {
        ...SAMPLE_RECOGNITION,
        sourceType: '固定账本本地预览',
        entries: [],
        uncertainMarks: [],
      },
      DEFAULT_PAPER_TEMPLATE,
    )
    const evaluation = evaluateMobileAuditUx(result)

    expect(evaluation.grade).not.toBe('S')
    expect(evaluation.criteria.find((criterion) => criterion.id === 'traceable-money')?.passed).toBe(false)
    expect(evaluation.criteria.find((criterion) => criterion.id === 'traceable-money')?.detail).toContain(
      '必须先校准',
    )
  })
})
