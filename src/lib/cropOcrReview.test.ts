import { describe, expect, it } from 'vitest'
import { applyCropOcrReview } from './cropOcrReview'
import type { ExternalOcrToken, RecognitionResult } from '../types'

function resultFixture(): RecognitionResult {
  return {
    title: '测试账本',
    sourceType: '手写表格',
    summary: '',
    currency: 'CNY',
    overallConfidence: 0.9,
    computedTotal: 51,
    calculationFormula: '中列 x 0.1',
    calculationProgram: {
      dslVersion: 'tong-ledger-dsl/v1',
      title: '测试账本',
      sourceType: '手写表格',
      summary: '',
      currency: 'CNY',
      calculationFormula: '中列 x 0.1',
      columnRules: [],
      terms: [
        {
          id: 'term-1',
          label: '5日中列',
          rowLabel: '5日',
          sourceTokenIds: ['visual-d5'],
          rawText: '510',
          normalizedText: '510',
          rawValue: 510,
          multiplier: 0.1,
          include: true,
          category: '金额',
          confidence: 0.9,
          formula: '510 x 0.1',
          note: '',
        },
      ],
      uncertainMarks: [],
      extractedText: [],
      auditNotes: [],
    },
    columnRules: [],
    entries: [
      {
        id: 'term-1',
        label: '5日中列',
        rowLabel: '5日',
        rawText: '510',
        normalizedText: '510',
        amount: 510,
        rawValue: 510,
        multiplier: 0.1,
        calculatedAmount: 51,
        formula: '510 x 0.1',
        category: '金额',
        confidence: 0.9,
        region: { x: 36, y: 22, width: 4, height: 2 },
        anchor: null,
        note: '',
      },
    ],
    uncertainMarks: [],
    extractedText: [],
    auditNotes: [],
    visualTokens: [
      {
        id: 'visual-d5',
        kind: 'number',
        label: '5日中列',
        rowLabel: '5日',
        columnLabel: '中列',
        rawText: '510',
        normalizedText: '510',
        numericValue: 510,
        candidates: [{ text: '510', confidence: 0.9 }],
        confidence: 0.9,
        region: { x: 36, y: 22, width: 4, height: 2 },
        anchor: null,
        note: '',
      },
    ],
  }
}

describe('applyCropOcrReview', () => {
  it('keeps the original token as primary and adds crop OCR candidates plus audit notes', () => {
    const cropTokens: ExternalOcrToken[] = [
      {
        id: 'crop-1',
        text: '570',
        confidence: 0.8,
        kind: 'number',
        provider: 'priority crop OCR',
        region: { x: 36.3, y: 22.2, width: 4, height: 2 },
      },
    ]

    const next = applyCropOcrReview(resultFixture(), cropTokens)

    expect(next.visualTokens?.[0].candidates.map((item) => item.text)).toContain('570')
    expect(next.entries[0].calculatedAmount).toBe(51)
    expect(next.auditNotes.join(' ')).toContain('外部 OCR 融合')
  })

  it('returns the original result when there is no calculation program or no crop OCR output', () => {
    const base = resultFixture()
    expect(applyCropOcrReview({ ...base, calculationProgram: undefined }, []).entries[0].rawText).toBe('510')
    expect(applyCropOcrReview(base, []).entries[0].rawText).toBe('510')
  })
})
