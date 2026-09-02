import { describe, expect, it } from 'vitest'
import { SAMPLE_RECOGNITION } from '../data/sampleRecognition'
import { DEFAULT_PAPER_TEMPLATE } from './paperTemplates'
import {
  buildLedgerCells,
  getCuttingFeasibility,
  getLedgerTableRegion,
  normalizeResultCells,
  summarizeGridCutPreviewReadiness,
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

  it('creates the full single-page review grid even before recognition', () => {
    const cells = buildLedgerCells(
      {
        ...SAMPLE_RECOGNITION,
        sourceType: '固定账本本地预览',
        entries: [],
        uncertainMarks: [],
      },
      DEFAULT_PAPER_TEMPLATE,
    )
    const reviewableCells = cells.filter(
      (cell) => cell.columnKind !== 'date' && cell.columnKind !== 'dailyTotal',
    )

    expect(cells).toHaveLength(31 * 9)
    expect(reviewableCells).toHaveLength(31 * 7)
    expect(cells.find((cell) => cell.id === 'r31-deduction')?.cropRef).toBe('cell:r31-deduction')
  })

  it('marks cells with local cut risk when grid-line evidence is weak', () => {
    const previewCells = buildLedgerCells(
      {
        ...SAMPLE_RECOGNITION,
        entries: [],
        uncertainMarks: [],
        gridCut: {
          method: 'hybrid-model',
          level: 'calibrate',
          label: '需先校准',
          score: 42,
          confidence: 0.42,
          tableRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
          fixedRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
          lines: {
            horizontal: [
              { axis: 'y', position: DEFAULT_PAPER_TEMPLATE.grid.tableRegion.y, strength: 0.92 },
              {
                axis: 'y',
                position:
                  DEFAULT_PAPER_TEMPLATE.grid.tableRegion.y + DEFAULT_PAPER_TEMPLATE.grid.tableRegion.height,
                strength: 0.91,
              },
            ],
            vertical: [
              { axis: 'x', position: DEFAULT_PAPER_TEMPLATE.grid.tableRegion.x, strength: 0.9 },
              {
                axis: 'x',
                position:
                  DEFAULT_PAPER_TEMPLATE.grid.tableRegion.x + DEFAULT_PAPER_TEMPLATE.grid.tableRegion.width,
                strength: 0.88,
              },
            ],
          },
          support: {
            expectedHorizontal: 33,
            expectedVertical: 9,
            detectedHorizontal: 2,
            detectedVertical: 2,
          },
          residuals: {
            x: 2.7,
            y: 3.1,
            max: 3.1,
          },
          fallback: {
            x: true,
            y: true,
          },
          reasons: ['局部格线不足'],
        },
      },
      DEFAULT_PAPER_TEMPLATE,
    )

    const centerCell = previewCells.find((cell) => cell.id === 'r10-paper-2')
    expect(centerCell?.cutEvidence.level).toBe('calibrate')
    expect(centerCell?.riskFlags).toContain('cutLowConfidence')
    expect(centerCell?.cutEvidence.reasons.join(' ')).toContain('模板回退')
  })

  it('allows review-level cutting when template-assisted lines fully cover the grid', () => {
    const yStep = DEFAULT_PAPER_TEMPLATE.grid.tableRegion.height / 32
    const xStep = DEFAULT_PAPER_TEMPLATE.grid.tableRegion.width / 9
    const previewCells = buildLedgerCells(
      {
        ...SAMPLE_RECOGNITION,
        entries: [],
        uncertainMarks: [],
        gridCut: {
          method: 'cnn-hybrid',
          level: 'review',
          label: '建议抽查',
          score: 66,
          confidence: 0.66,
          tableRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
          fixedRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
          lines: {
            horizontal: Array.from({ length: 33 }, (_, index) => ({
              axis: 'y' as const,
              position: DEFAULT_PAPER_TEMPLATE.grid.tableRegion.y + yStep * index,
              strength: index % 3 === 0 ? 0.9 : 0.2,
            })),
            vertical: Array.from({ length: 10 }, (_, index) => ({
              axis: 'x' as const,
              position: DEFAULT_PAPER_TEMPLATE.grid.tableRegion.x + xStep * index,
              strength: index === 0 || index === 9 ? 0.88 : 0.2,
            })),
          },
          support: {
            expectedHorizontal: 33,
            expectedVertical: 10,
            detectedHorizontal: 12,
            detectedVertical: 2,
          },
          residuals: {
            x: 0.8,
            y: 0.9,
            max: 0.9,
          },
          fallback: {
            x: true,
            y: false,
          },
          reasons: ['模板补线后已形成完整格网'],
        },
      },
      DEFAULT_PAPER_TEMPLATE,
    )

    const centerCell = previewCells.find((cell) => cell.id === 'r10-paper-2')
    expect(centerCell?.cutEvidence.level).toBe('review')
    expect(centerCell?.riskFlags).not.toContain('cutLowConfidence')
  })

  it('marks template-assisted preview as send-with-review when most cells are locally stable', () => {
    const yStep = DEFAULT_PAPER_TEMPLATE.grid.tableRegion.height / 32
    const xStep = DEFAULT_PAPER_TEMPLATE.grid.tableRegion.width / 9
    const readiness = summarizeGridCutPreviewReadiness(
      {
        method: 'cnn-hybrid',
        level: 'calibrate',
        label: '需先校准',
        score: 47,
        confidence: 0.47,
        tableRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
        fixedRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
        lines: {
          horizontal: Array.from({ length: 33 }, (_, index) => ({
            axis: 'y' as const,
            position: DEFAULT_PAPER_TEMPLATE.grid.tableRegion.y + yStep * index,
            strength: index % 4 === 0 ? 0.88 : 0.18,
          })),
          vertical: Array.from({ length: 10 }, (_, index) => ({
            axis: 'x' as const,
            position: DEFAULT_PAPER_TEMPLATE.grid.tableRegion.x + xStep * index,
            strength: index === 1 ? 0.68 : 0.16,
          })),
        },
        support: {
          expectedHorizontal: 33,
          expectedVertical: 10,
          detectedHorizontal: 15,
          detectedVertical: 2,
        },
        residuals: {
          x: null,
          y: 0.73,
          max: 0.73,
        },
        fallback: {
          x: true,
          y: false,
        },
        reasons: ['模板约束补线后大部分格子已贴线'],
      },
      DEFAULT_PAPER_TEMPLATE,
    )

    expect(readiness.modelGate).toBe('send-with-review')
    expect(readiness.ocrCriticalLowCutRatio).toBeLessThanOrEqual(0.26)
    expect(readiness.meanCutConfidence).toBeGreaterThanOrEqual(0.58)
  })

  it('treats sparse but template-pulled vertical drift as reviewable instead of blocking OCR', () => {
    const yStep = 92.55 / 32
    const readiness = summarizeGridCutPreviewReadiness(
      {
        method: 'cnn-hybrid',
        level: 'calibrate',
        label: '需先校准',
        score: 49,
        confidence: 0.49,
        tableRegion: {
          x: 6.72,
          y: 4.64,
          width: 70.84,
          height: 92.55,
        },
        fixedRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
        lines: {
          horizontal: Array.from({ length: 33 }, (_, index) => ({
            axis: 'y' as const,
            position: Math.round((4.64 + yStep * index) * 100) / 100,
            strength: index < 5 || index > 28 ? 0.16 : 0.28,
          })),
          vertical: [6.72, 14.9, 23.19, 30.91, 38.2, 45.41, 53.95, 61.82, 69.69, 77.56].map((position, index) => ({
            axis: 'x' as const,
            position,
            strength: [0.16, 0.326, 0.446, 0.255, 0.16, 0.22, 0.16, 0.16, 0.16, 0.16][index],
          })),
        },
        support: {
          expectedHorizontal: 33,
          expectedVertical: 10,
          detectedHorizontal: 20,
          detectedVertical: 4,
        },
        residuals: {
          x: 0.13,
          y: 0.38,
          max: 0.38,
        },
        fallback: {
          x: true,
          y: true,
        },
        reasons: ['模板补线后列漂移已被约束回固定账本'],
      },
      DEFAULT_PAPER_TEMPLATE,
    )

    expect(readiness.modelGate).toBe('send-with-review')
    expect(readiness.lowCutRatio).toBeLessThanOrEqual(0.01)
    expect(readiness.ocrCriticalLowCutRatio).toBeLessThanOrEqual(0.01)
  })

  it('keeps one-line vertical projection reviewable when template补线已补齐整列', () => {
    const yStep = 92.55 / 32
    const xStep = 70.84 / 9
    const readiness = summarizeGridCutPreviewReadiness(
      {
        method: 'cnn-hybrid',
        level: 'calibrate',
        label: '需先校准',
        score: 44,
        confidence: 0.44,
        tableRegion: {
          x: 6.72,
          y: 4.64,
          width: 70.84,
          height: 92.55,
        },
        fixedRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
        lines: {
          horizontal: Array.from({ length: 33 }, (_, index) => ({
            axis: 'y' as const,
            position: Math.round((4.64 + yStep * index) * 100) / 100,
            strength: index < 4 || index > 28 ? 0.18 : 0.28,
          })),
          vertical: Array.from({ length: 10 }, (_, index) => ({
            axis: 'x' as const,
            position: Math.round((6.72 + xStep * index) * 100) / 100,
            strength: index === 4 ? 0.41 : 0.16,
          })),
        },
        support: {
          expectedHorizontal: 33,
          expectedVertical: 10,
          detectedHorizontal: 19,
          detectedVertical: 1,
        },
        residuals: {
          x: 0.31,
          y: 0.42,
          max: 0.42,
        },
        fallback: {
          x: true,
          y: false,
        },
        reasons: ['单条真竖线已由模板投影补成完整列格'],
      },
      DEFAULT_PAPER_TEMPLATE,
    )

    expect(readiness.modelGate).toBe('send-with-review')
    expect(readiness.meanCutConfidence).toBeGreaterThanOrEqual(0.58)
    expect(readiness.ocrCriticalLowCutRatio).toBeLessThanOrEqual(0.02)
  })

  it('rescues slightly drifted rows when single-axis template projection is otherwise stable', () => {
    const yStep = 92.55 / 32
    const xStep = 70.84 / 9
    const readiness = summarizeGridCutPreviewReadiness(
      {
        method: 'cnn-hybrid',
        level: 'calibrate',
        label: '需先校准',
        score: 25,
        confidence: 0.25,
        tableRegion: {
          x: 6.72,
          y: 4.64,
          width: 70.84,
          height: 92.55,
        },
        fixedRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
        lines: {
          horizontal: Array.from({ length: 33 }, (_, index) => ({
            axis: 'y' as const,
            position: Math.round((4.64 + yStep * index + (index < 16 ? 0.26 : 0)) * 100) / 100,
            strength: index < 5 || index > 28 ? 0.16 : 0.28,
          })),
          vertical: Array.from({ length: 10 }, (_, index) => ({
            axis: 'x' as const,
            position: Math.round((6.72 + xStep * index) * 100) / 100,
            strength: index === 1 ? 0.69 : 0.16,
          })),
        },
        support: {
          expectedHorizontal: 33,
          expectedVertical: 10,
          detectedHorizontal: 21,
          detectedVertical: 1,
          alignedVerticalSynthetic: 9,
        },
        residuals: {
          x: null,
          y: 0.4,
          max: 0.4,
        },
        fallback: {
          x: true,
          y: true,
        },
        reasons: ['单轴模板投影已稳定，横线仅有轻微漂移'],
      },
      DEFAULT_PAPER_TEMPLATE,
    )

    expect(readiness.modelGate).toBe('send-with-review')
    expect(readiness.ocrCriticalLowCutRatio).toBeLessThanOrEqual(0.26)
    expect(readiness.meanCutConfidence).toBeGreaterThanOrEqual(0.58)
  })

  it('rescues mirrored single-horizontal projection when columns are stable but row lines are mostly synthetic', () => {
    const yStep = 91.34 / 32
    const xStep = 71.24 / 9
    const readiness = summarizeGridCutPreviewReadiness(
      {
        method: 'cnn-hybrid',
        level: 'calibrate',
        label: '需先校准',
        score: 12,
        confidence: 0.12,
        tableRegion: {
          x: 6.92,
          y: 3.88,
          width: 71.24,
          height: 91.34,
        },
        fixedRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
        lines: {
          horizontal: Array.from({ length: 33 }, (_, index) => ({
            axis: 'y' as const,
            position: Math.round((3.88 + yStep * index) * 100) / 100,
            strength: index === 0 ? 0.46 : index >= 18 && index <= 19 ? 0.22 : 0.16,
          })),
          vertical: Array.from({ length: 10 }, (_, index) => ({
            axis: 'x' as const,
            position: Math.round((6.92 + xStep * index) * 100) / 100,
            strength: index === 0 ? 0.24 : 0.16,
          })),
        },
        support: {
          expectedHorizontal: 33,
          expectedVertical: 10,
          detectedHorizontal: 3,
          detectedVertical: 3,
          alignedHorizontalSynthetic: 30,
          alignedVerticalSynthetic: 9,
        },
        residuals: {
          x: 1,
          y: 0.12,
          max: 1,
        },
        fallback: {
          x: true,
          y: true,
        },
        reasons: ['横线真证据很少，但模板投影与列格仍稳定贴合'],
      },
      DEFAULT_PAPER_TEMPLATE,
    )

    expect(readiness.modelGate).toBe('send-with-review')
    expect(readiness.lowCutRatio).toBeLessThanOrEqual(0.26)
    expect(readiness.ocrCriticalLowCutRatio).toBeLessThanOrEqual(0.26)
  })

  it('rescues model-projected columns when row fit is extremely stable even with only one real vertical line', () => {
    const yStep = 91.43 / 32
    const xStep = 71.33 / 9
    const readiness = summarizeGridCutPreviewReadiness(
      {
        method: 'cnn-hybrid',
        level: 'calibrate',
        label: '需先校准',
        score: 20,
        confidence: 0.2,
        tableRegion: {
          x: 7.74,
          y: 3.94,
          width: 71.33,
          height: 91.43,
        },
        fixedRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
        lines: {
          horizontal: Array.from({ length: 33 }, (_, index) => ({
            axis: 'y' as const,
            position: Math.round((3.94 + yStep * index) * 100) / 100,
            strength: index < 2 || (index >= 12 && index <= 16) ? 0.22 : 0.16,
          })),
          vertical: Array.from({ length: 10 }, (_, index) => ({
            axis: 'x' as const,
            position: Math.round((7.74 + xStep * index) * 100) / 100,
            strength: 0.16,
          })),
        },
        support: {
          expectedHorizontal: 33,
          expectedVertical: 10,
          detectedHorizontal: 8,
          detectedVertical: 1,
          alignedHorizontalSynthetic: 26,
          alignedVerticalSynthetic: 10,
        },
        residuals: {
          x: null,
          y: 0.04,
          max: 0.04,
        },
        fallback: {
          x: true,
          y: true,
        },
        reasons: ['行线残差极低，允许纯模板列投影参与切格'],
      },
      DEFAULT_PAPER_TEMPLATE,
    )

    expect(readiness.modelGate).toBe('send-with-review')
    expect(readiness.lowCutRatio).toBeLessThanOrEqual(0.26)
    expect(readiness.ocrCriticalLowCutRatio).toBeLessThanOrEqual(0.26)
  })

  it('rescues template-projected pages when both axes still have some real support', () => {
    const yStep = 91.44 / 32
    const readiness = summarizeGridCutPreviewReadiness(
      {
        method: 'cnn-hybrid',
        level: 'calibrate',
        label: '需先校准',
        score: 18,
        confidence: 0.18,
        tableRegion: {
          x: 7.9,
          y: 3.94,
          width: 71.34,
          height: 91.44,
        },
        fixedRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
        lines: {
          horizontal: Array.from({ length: 33 }, (_, index) => ({
            axis: 'y' as const,
            position: Math.round((3.94 + yStep * index) * 100) / 100,
            strength: index === 0 ? 0.389 : index % 9 === 0 ? 0.22 : 0.16,
          })),
          vertical: [7.9, 15.83, 23.75, 31.68, 39.61, 47.53, 55.46, 63.39, 71.31, 79.24].map((position, index) => ({
            axis: 'x' as const,
            position,
            strength: index === 9 ? 0.225 : 0.16,
          })),
        },
        support: {
          expectedHorizontal: 33,
          expectedVertical: 10,
          detectedHorizontal: 5,
          detectedVertical: 2,
        },
        residuals: {
          x: null,
          y: 0.17,
          max: 0.17,
        },
        fallback: {
          x: true,
          y: true,
        },
        reasons: ['模板投影格网与固定账本仍然贴合'],
      },
      DEFAULT_PAPER_TEMPLATE,
    )

    expect(readiness.modelGate).toBe('send-with-review')
    expect(readiness.meanCutConfidence).toBeGreaterThanOrEqual(0.58)
    expect(readiness.ocrCriticalLowCutRatio).toBeLessThanOrEqual(0.01)
  })

  it('keeps hold when local preview still has too many weak cells', () => {
    const readiness = summarizeGridCutPreviewReadiness(
      {
        method: 'cnn-hybrid',
        level: 'calibrate',
        label: '需先校准',
        score: 16,
        confidence: 0.16,
        tableRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
        fixedRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
        lines: {
          horizontal: Array.from({ length: 2 }, (_, index) => ({
            axis: 'y' as const,
            position:
              index === 0
                ? DEFAULT_PAPER_TEMPLATE.grid.tableRegion.y
                : DEFAULT_PAPER_TEMPLATE.grid.tableRegion.y + DEFAULT_PAPER_TEMPLATE.grid.tableRegion.height,
            strength: 0.22,
          })),
          vertical: Array.from({ length: 2 }, (_, index) => ({
            axis: 'x' as const,
            position:
              index === 0
                ? DEFAULT_PAPER_TEMPLATE.grid.tableRegion.x
                : DEFAULT_PAPER_TEMPLATE.grid.tableRegion.x + DEFAULT_PAPER_TEMPLATE.grid.tableRegion.width,
            strength: 0.22,
          })),
        },
        support: {
          expectedHorizontal: 33,
          expectedVertical: 10,
          detectedHorizontal: 2,
          detectedVertical: 2,
        },
        residuals: {
          x: 2.6,
          y: 3.1,
          max: 3.1,
        },
        fallback: {
          x: true,
          y: true,
        },
        reasons: ['局部格线过少'],
      },
      DEFAULT_PAPER_TEMPLATE,
    )

    expect(readiness.modelGate).toBe('hold')
    expect(readiness.lowCutRatio).toBeGreaterThan(0.26)
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
    expect(feasibility.support.distinctRows).toBeGreaterThanOrEqual(8)
    expect(feasibility.support.distinctColumns).toBeGreaterThanOrEqual(2)
    expect(['good', 'review', 'calibrate']).toContain(feasibility.level)
  })

  it('does not mark fallback template cutting as good when evidence is sparse', () => {
    const sparseResult = {
      ...SAMPLE_RECOGNITION,
      entries: SAMPLE_RECOGNITION.entries.slice(0, 1),
    }
    const feasibility = getCuttingFeasibility(sparseResult, DEFAULT_PAPER_TEMPLATE)

    expect(feasibility.maxDelta).toBe(0)
    expect(feasibility.fallback.x || feasibility.fallback.y).toBe(true)
    expect(feasibility.support.distinctRows).toBeLessThan(8)
    expect(feasibility.level).not.toBe('good')
  })

  it('requires both row and column support before direct cutting is allowed', () => {
    const oneColumnResult = {
      ...SAMPLE_RECOGNITION,
      entries: SAMPLE_RECOGNITION.entries.filter((entry) => entry.label.includes('中列')),
    }
    const oneRowResult = {
      ...SAMPLE_RECOGNITION,
      entries: SAMPLE_RECOGNITION.entries.filter((entry) => entry.rowLabel === '4日'),
    }

    const oneColumnFeasibility = getCuttingFeasibility(oneColumnResult, DEFAULT_PAPER_TEMPLATE)
    const oneRowFeasibility = getCuttingFeasibility(oneRowResult, DEFAULT_PAPER_TEMPLATE)

    expect(oneColumnFeasibility.fallback.x).toBe(true)
    expect(oneColumnFeasibility.level).not.toBe('good')
    expect(oneRowFeasibility.fallback.y).toBe(true)
    expect(oneRowFeasibility.level).not.toBe('good')
  })

  it('downgrades high-residual fits even when support exists', () => {
    const noisyResult = {
      ...SAMPLE_RECOGNITION,
      entries: SAMPLE_RECOGNITION.entries.map((entry, index) => ({
        ...entry,
        region: {
          ...entry.region,
          y: entry.region.y + (index % 3 === 0 ? 10 : index % 3 === 1 ? -6 : 0),
        },
      })),
    }
    const feasibility = getCuttingFeasibility(noisyResult, DEFAULT_PAPER_TEMPLATE)

    expect(feasibility.support.distinctRows).toBeGreaterThanOrEqual(8)
    expect(feasibility.residuals.max ?? 0).toBeGreaterThan(1.8)
    expect(feasibility.level).not.toBe('good')
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
