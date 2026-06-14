import { describe, expect, it } from 'vitest'
import { SAMPLE_RECOGNITION } from '../data/sampleRecognition'
import { DEFAULT_PAPER_TEMPLATE } from './paperTemplates'
import {
  buildLedgerCells,
  getCuttingFeasibility,
  getLedgerTableRegion,
  normalizeResultCells,
  updateLedgerCell,
} from './ledgerCells'
import { summarizeRecognition } from './calculation'

describe('ledger cells', () => {
  it('generates a complete fixed grid including blank cells', () => {
    const cells = buildLedgerCells(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE)

    expect(cells).toHaveLength(DEFAULT_PAPER_TEMPLATE.rowCount * DEFAULT_PAPER_TEMPLATE.grid.columns.length)
    expect(cells.find((cell) => cell.id === 'r4-paper-1')?.rawText).toContain('584')
    expect(cells.find((cell) => cell.id === 'r1-paper-1')?.semanticType).toBe('blank')
    expect(cells.find((cell) => cell.id === 'r1-paper-1')?.riskFlags).toContain(
      'possibleMissedDigit',
    )
  })

  it('keeps the calibrated sample total after attaching cell evidence', () => {
    const result = normalizeResultCells(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE)

    expect(result.cells?.some((cell) => cell.id === 'r4-paper-1')).toBe(true)
    expect(summarizeRecognition(result).total).toBe(2860.38)
  })

  it('calibrates the fixed grid to the notebook table instead of the whole photo', () => {
    const tableRegion = getLedgerTableRegion(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE)
    const cells = buildLedgerCells(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE)
    const cell = cells.find((item) => item.id === 'r4-paper-1')
    const entry = SAMPLE_RECOGNITION.entries.find((item) => item.id === 'd4-a')

    expect(tableRegion.x).toBeGreaterThan(5)
    expect(tableRegion.y).toBeGreaterThan(4)
    expect(tableRegion.width).toBeLessThan(85)
    expect(tableRegion.height).toBeGreaterThan(90)
    expect(cell).toBeTruthy()
    expect(entry).toBeTruthy()

    const entryCenter = {
      x: entry!.region.x + entry!.region.width / 2,
      y: entry!.region.y + entry!.region.height / 2,
    }
    expect(entryCenter.x).toBeGreaterThanOrEqual(cell!.bboxOriginal.x)
    expect(entryCenter.x).toBeLessThanOrEqual(cell!.bboxOriginal.x + cell!.bboxOriginal.width)
    expect(entryCenter.y).toBeGreaterThanOrEqual(cell!.bboxOriginal.y)
    expect(entryCenter.y).toBeLessThanOrEqual(cell!.bboxOriginal.y + cell!.bboxOriginal.height)
  })

  it('reports cutting feasibility by comparing fixed and calibrated table regions', () => {
    const feasibility = getCuttingFeasibility(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE)

    expect(feasibility.fixedRegion).toEqual(DEFAULT_PAPER_TEMPLATE.grid.tableRegion)
    expect(feasibility.calibratedRegion.width).toBeGreaterThan(40)
    expect(feasibility.maxDelta).toBeGreaterThanOrEqual(0)
    expect(['good', 'review', 'calibrate']).toContain(feasibility.level)
  })

  it('normalizes cells idempotently without duplicating entry evidence', () => {
    const once = normalizeResultCells(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE)
    const twice = normalizeResultCells(once, DEFAULT_PAPER_TEMPLATE)

    expect(twice.cells?.find((cell) => cell.id === 'r4-paper-1')?.rawText).toBe('584')
    expect(twice.cells?.find((cell) => cell.id === 'r4-paper-1')?.amount).toBe(58.4)
    expect(summarizeRecognition(twice).total).toBe(2860.38)
  })

  it('can fill an empty cell and recalculate through derived entries', () => {
    const updated = updateLedgerCell(
      normalizeResultCells(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE),
      DEFAULT_PAPER_TEMPLATE,
      'r1-paper-1',
      {
        rawText: '10',
        normalizedText: '10',
        semanticType: 'quantity',
      },
    )

    const addedEntry = updated.entries.find((entry) => entry.id === 'cell-entry:r1-paper-1')
    expect(addedEntry?.cellId).toBe('r1-paper-1')
    expect(addedEntry?.multiplier).toBe(0.1)
    expect(addedEntry?.calculatedAmount).toBe(1)
    expect(summarizeRecognition(updated).total).toBe(2861.38)
    expect(updated.cells?.find((cell) => cell.id === 'r1-paper-1')?.riskFlags).toContain(
      'userEdited',
    )
  })

  it('maps edited product cells to directional column rules when unit prices are not configured', () => {
    const updated = updateLedgerCell(
      normalizeResultCells(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE),
      DEFAULT_PAPER_TEMPLATE,
      'r1-paper-2',
      {
        rawText: '10',
        normalizedText: '10',
        semanticType: 'quantity',
      },
    )

    const addedEntry = updated.entries.find((entry) => entry.id === 'cell-entry:r1-paper-2')
    expect(addedEntry?.multiplier).toBe(0.088)
    expect(addedEntry?.calculatedAmount).toBe(0.88)
    expect(summarizeRecognition(updated).total).toBe(2861.26)
  })
})
