import { buildCropOcrPlan } from './cropOcrPlan'
import type { PaperTemplate, RecognitionResult } from '../types'
import { getCuttingFeasibility } from './ledgerCells'
import { getTemplateGrid } from './paperTemplates'

export function buildLedgerExportPayload(result: RecognitionResult, template: PaperTemplate) {
  const cutting = getCuttingFeasibility(result, template)
  const cropOcrPlan = buildCropOcrPlan(result, template)
  const grid = getTemplateGrid(template)

  return {
    exportVersion: 'tong-ledger-export/v2',
    exportedAt: new Date().toISOString(),
    result,
    audit: {
      paperTemplate: {
        id: template.id,
        name: template.name,
        rowCount: template.rowCount,
        columns: grid.columns,
        tableRegion: grid.tableRegion,
        columnRatios: grid.columnRatios,
        rowRatios: grid.rowRatios,
      },
      cuttingEvidence: {
        level: cutting.level,
        label: cutting.label,
        score: cutting.score,
        fixedRegion: cutting.fixedRegion,
        calibratedRegion: cutting.calibratedRegion,
        deltas: cutting.deltas,
        maxDelta: cutting.maxDelta,
        support: cutting.support,
        residuals: cutting.residuals,
        fallback: cutting.fallback,
      },
      cropOcrPlan,
      cropOcrExecution: result.cropOcrExecution,
      cellEvidence: (result.cells ?? []).map((cell) => ({
        cellId: cell.id,
        row: cell.row,
        columnId: cell.columnId,
        columnLabel: cell.columnLabel,
        bboxOriginal: cell.bboxOriginal,
        bboxWarped: cell.bboxWarped,
        cropRef: cell.cropRef,
        rawText: cell.rawText,
        semanticType: cell.semanticType,
        cutEvidence: cell.cutEvidence,
        amount: cell.amount,
        riskFlags: cell.riskFlags,
        entryIds: cell.entryIds,
      })),
    },
  }
}
