import { describe, expect, it } from 'vitest'
import { SAMPLE_RECOGNITION } from '../data/sampleRecognition'
import { buildLedgerExportPayload } from './export'
import { normalizeResultCells } from './ledgerCells'
import { DEFAULT_PAPER_TEMPLATE } from './paperTemplates'

describe('ledger export payload', () => {
  it('exports cutting evidence and per-cell source evidence for audit', () => {
    const result = normalizeResultCells(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE)
    const payload = buildLedgerExportPayload(result, DEFAULT_PAPER_TEMPLATE)

    expect(payload.exportVersion).toBe('tong-ledger-export/v2')
    expect(payload.audit.cuttingEvidence.support.distinctRows).toBeGreaterThan(0)
    expect(payload.audit.cuttingEvidence.residuals).toHaveProperty('max')
    expect(payload.audit.cuttingEvidence.fallback).toHaveProperty('x')
    expect(payload.audit.paperTemplate.tableRegion).toEqual(DEFAULT_PAPER_TEMPLATE.grid.tableRegion)
    expect(payload.audit.cropOcrPlan.strategy).toBe('page-plus-priority-crops')
    expect(payload.audit.cropOcrPlan.reviewableCellCount).toBeGreaterThan(0)
    expect(payload.audit).toHaveProperty('cropOcrExecution')
    expect(payload.audit.cellEvidence).toHaveLength(result.cells?.length ?? 0)
    expect(payload.audit.cellEvidence.every((cell) => cell.cellId && cell.bboxOriginal && cell.cropRef)).toBe(
      true,
    )
  })
})
