import { buildLedgerCells, riskFlagLabel } from './ledgerCells'
import type { CropOcrPlan, CropOcrTask, LedgerCell, PaperTemplate, RecognitionResult } from '../types'

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function amountImpactForCell(cell: LedgerCell) {
  return Math.abs(cell.amount ?? 0)
}

function readConfidenceForCell(cell: LedgerCell) {
  if (!cell.rawText.trim()) return cell.blankConfidence
  return cell.confidence
}

function scoreTask(cell: LedgerCell): Omit<CropOcrTask, 'priority' | 'shouldSend'> {
  const flags = cell.riskFlags.filter((flag) => flag !== 'userEdited')
  const amountImpact = amountImpactForCell(cell)
  const cutRisk = 1 - cell.cutEvidence.confidence
  const readConfidence = readConfidenceForCell(cell)
  const readRisk = 1 - readConfidence
  const flagRisk = Math.min(0.44, flags.length * 0.11)
  const amountRisk = Math.min(0.2, amountImpact / 220)
  const missedDigitBoost = cell.riskFlags.includes('possibleMissedDigit') ? 0.24 : 0
  const cutBoost = cell.riskFlags.includes('cutLowConfidence') ? 0.27 : 0
  const lowConfidenceBoost = cell.riskFlags.includes('lowConfidence') ? 0.16 : 0
  const score = clamp(
    cutRisk * 0.42 +
      readRisk * 0.26 +
      flagRisk +
      amountRisk +
      missedDigitBoost +
      cutBoost +
      lowConfidenceBoost,
    0,
    1,
  )
  const reasons = [
    cell.cutEvidence.level === 'calibrate' ? '切格证据偏弱' : '',
    cell.riskFlags.includes('possibleMissedDigit') ? '空白格疑似漏字' : '',
    cell.riskFlags.includes('lowConfidence') ? '整页识别低置信' : '',
    cell.riskFlags.includes('crossCell') ? '可能跨格' : '',
    cell.riskFlags.includes('nearBorder') ? '贴近页边' : '',
    amountImpact >= 30 ? `金额影响 ${round(amountImpact)}` : '',
  ].filter(Boolean)

  if (!reasons.length) reasons.push(cell.cutEvidence.reasons[0] ?? '建议保留整页审核')

  return {
    cellId: cell.id,
    row: cell.row,
    columnLabel: cell.columnLabel,
    region: cell.bboxOriginal,
    cropRef: cell.cropRef,
    score: round(score, 2),
    amountImpact: round(amountImpact, 2),
    cutConfidence: round(cell.cutEvidence.confidence, 2),
    readConfidence: round(readConfidence, 2),
    reasons,
  }
}

function withPriority(task: Omit<CropOcrTask, 'priority' | 'shouldSend'>): CropOcrTask {
  const priority: CropOcrTask['priority'] =
    task.score >= 0.72 ? 'high' : task.score >= 0.46 ? 'medium' : 'low'
  const shouldSend =
    task.score >= 0.62 ||
    task.reasons.includes('切格证据偏弱') ||
    task.reasons.includes('空白格疑似漏字')

  return {
    ...task,
    priority,
    shouldSend,
  }
}

export function buildCropOcrPlan(
  result: RecognitionResult,
  template: PaperTemplate,
): CropOcrPlan {
  const cells = (result.cells ?? buildLedgerCells(result, template)).filter(
    (cell) => cell.columnKind !== 'date' && cell.columnKind !== 'dailyTotal' && !cell.riskFlags.includes('userEdited'),
  )
  const tasks = cells
    .map(scoreTask)
    .map(withPriority)
    .sort((a, b) => b.score - a.score || b.amountImpact - a.amountImpact)

  const recommended = tasks.filter((task) => task.shouldSend).slice(0, 24)
  const recommendedIds = new Set(recommended.map((task) => task.cellId))
  const deferred = tasks
    .filter((task) => !recommendedIds.has(task.cellId) && task.score >= 0.42)
    .slice(0, 18)
  const deferredIds = new Set(deferred.map((task) => task.cellId))
  const skipped = tasks.filter((task) => !recommendedIds.has(task.cellId) && !deferredIds.has(task.cellId))
  const estimatedSavingsRatio =
    tasks.length > 0 ? clamp(1 - recommended.length / tasks.length, 0, 1) : 1
  const topReasons = Array.from(
    new Set(recommended.flatMap((task) => task.reasons.slice(0, 2))),
  ).slice(0, 4)

  return {
    strategy: 'page-plus-priority-crops',
    pageImageCount: 1,
    reviewableCellCount: tasks.length,
    recommendedCropCount: recommended.length,
    deferredCropCount: deferred.length,
    skippedCropCount: skipped.length,
    estimatedSavingsRatio: round(estimatedSavingsRatio, 2),
    tokenBudgetLabel:
      recommended.length === 0
        ? '整页即可'
        : `整页 1 张 + 建议小图 ${recommended.length} 张，较全量小图减少 ${Math.round(
            estimatedSavingsRatio * 100,
          )}%`,
    notes: [
      '本地切格与重建表格不消耗 token。',
      '先看整页与切格证据，再只把高风险格送小图 OCR。',
      '小图 OCR 回来后只作为候选证据，与整页结果冲突时保留人工确认。',
      ...topReasons,
    ],
    tasks,
  }
}

export function cropOcrTaskLabel(task: CropOcrTask) {
  return `${task.row}日${task.columnLabel}`
}

export function cropOcrTaskReasonLine(task: CropOcrTask) {
  return task.reasons.slice(0, 2).join(' / ')
}

export function cropOcrRiskSummary(cell: LedgerCell) {
  return cell.riskFlags.filter((flag) => flag !== 'userEdited').map((flag) => riskFlagLabel(flag))
}
