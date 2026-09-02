import { describe, expect, it } from 'vitest'
import { buildVerificationQueue } from './verification'
import type { LedgerCell, RecognitionResult } from '../types'

function makeCell(patch: Partial<LedgerCell>): LedgerCell {
  return {
    id: 'r1-paper-1',
    row: 1,
    columnId: 'paper-1',
    columnLabel: '纸类1',
    columnKind: 'product',
    bboxOriginal: { x: 10, y: 10, width: 10, height: 4 },
    bboxWarped: { x: 10, y: 10, width: 10, height: 4 },
    cropRef: 'cell:r1-paper-1',
    rawText: '',
    normalizedText: '',
    semanticType: 'blank',
    blankConfidence: 0.8,
    confidence: 0.8,
    cutEvidence: {
      confidence: 0.8,
      level: 'review',
      reasons: ['当前格子四边都贴近检测格线'],
      lineDeltas: { left: 0, right: 0, top: 0, bottom: 0 },
    },
    riskFlags: [],
    entryIds: [],
    amount: null,
    note: '',
    ...patch,
  }
}

describe('verification queue', () => {
  it('prioritizes cut-low-confidence cells for audit first', () => {
    const result: RecognitionResult = {
      title: 'test',
      sourceType: 'local',
      summary: '',
      currency: 'CNY',
      overallConfidence: 0.5,
      entries: [],
      uncertainMarks: [],
      extractedText: [],
      auditNotes: [],
      cells: [
        makeCell({
          id: 'r3-paper-2',
          row: 3,
          columnId: 'paper-2',
          columnLabel: '纸类2',
          riskFlags: ['cutLowConfidence'],
          cutEvidence: {
            confidence: 0.41,
            level: 'calibrate',
            reasons: ['模板投影格网仍贴合固定账本，可先审后识别'],
            lineDeltas: { left: 0.9, right: 0.8, top: 0.1, bottom: 0.1 },
          },
        }),
        makeCell({
          id: 'r2-paper-1',
          row: 2,
          riskFlags: ['possibleMissedDigit'],
          cutEvidence: {
            confidence: 0.79,
            level: 'review',
            reasons: ['当前格子四边都贴近检测格线'],
            lineDeltas: { left: 0, right: 0, top: 0, bottom: 0 },
          },
        }),
      ],
    }

    const queue = buildVerificationQueue(result)

    expect(queue[0]?.targetId).toBe('r3-paper-2')
    expect(queue[0]?.detail).toContain('切格低置信')
  })
})
