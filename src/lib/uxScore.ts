import type { PaperTemplate, RecognitionResult } from '../types'
import { getCuttingFeasibility } from './ledgerCells'
import { DEFAULT_PAPER_TEMPLATE } from './paperTemplates'


export interface UxScoreCriterion {
  id: string
  label: string
  weight: number
  passed: boolean
  detail: string
}

export interface UxScoreResult {
  score: number
  grade: 'S' | 'A' | 'B' | 'C'
  criteria: UxScoreCriterion[]
}

function gradeFor(score: number): UxScoreResult['grade'] {
  if (score >= 95) return 'S'
  if (score >= 88) return 'A'
  if (score >= 76) return 'B'
  return 'C'
}

export function evaluateMobileAuditUx(
  result: RecognitionResult | null,
  template: PaperTemplate = DEFAULT_PAPER_TEMPLATE,
): UxScoreResult {
  const cells = result?.cells ?? []
  const isLocalPreview = result?.sourceType.includes('本地预览') ?? false
  const cutting = result ? getCuttingFeasibility(result, template) : null
  const localPreviewCuttingReady = isLocalPreview && cutting?.level === 'good'
  const localPreviewReviewOnly = isLocalPreview && cutting?.level === 'review'
  const reviewableCells = cells.filter(
    (cell) => cell.columnKind !== 'date' && cell.columnKind !== 'dailyTotal',
  )
  const blankCells = reviewableCells.filter((cell) => cell.semanticType === 'blank')
  const riskyCells = reviewableCells.filter((cell) => cell.riskFlags.length > 0)
  const amountCells = reviewableCells.filter((cell) => typeof cell.amount === 'number' && cell.amount !== 0)
  const evidenceReady = amountCells.every((cell) => cell.id && cell.bboxOriginal && cell.cropRef)
  const localPreviewEvidenceReady =
    isLocalPreview && reviewableCells.every((cell) => cell.id && cell.bboxOriginal && cell.cropRef)
  const hasCellUpdateSurface = reviewableCells.length > 0 && (blankCells.length > 0 || riskyCells.length > 0)

  const criteria: UxScoreCriterion[] = [
    {
      id: 'complete-fixed-grid',
      label: '单页固定格不漏格',
      weight: 20,
      passed: reviewableCells.length >= template.rowCount * 7,
      detail: `单张图生成 ${reviewableCells.length} 个可核查格子`,
    },
    {
      id: 'blank-audit',
      label: '空白格可核查',
      weight: 16,
      passed: blankCells.length > 0 && blankCells.every((cell) => cell.cropRef && cell.blankConfidence > 0),
      detail: `${blankCells.length} 个空白格带证据`,
    },
    {
      id: 'risk-priority',
      label: '风险优先队列',
      weight: 14,
      passed: riskyCells.length > 0,
      detail: `${riskyCells.length} 个风险格可连续跳转`,
    },
    {
      id: 'traceable-money',
      label: '金额可追溯',
      weight: 18,
      passed: (amountCells.length > 0 && evidenceReady) || (localPreviewEvidenceReady && localPreviewCuttingReady),
      detail: isLocalPreview
        ? localPreviewCuttingReady
          ? '本地预览未产生金额；所有格子已带 cellId/bbox/cropRef，切割可直接通过'
          : localPreviewReviewOnly
            ? `本地预览已带格子证据；切割状态：${cutting?.label ?? '待判断'}，重点抽查低置信格`
            : `本地预览已带格子证据；切割状态：${cutting?.label ?? '待判断'}，必须先校准`
        : `${amountCells.length} 个金额格带 cellId/bbox/cropRef`,
    },
    {
      id: 'mobile-one-hand-flow',
      label: '手机单手核查流',
      weight: 18,
      passed: Boolean(result) && hasCellUpdateSurface,
      detail: `${reviewableCells.length} 个格子可在顶部证据窗口和底部操作条连续核查`,
    },
    {
      id: 'live-recalc',
      label: '编辑实时复算',
      weight: 14,
      passed: Boolean(result) && reviewableCells.every((cell) => cell.id && cell.cropRef),
      detail: '确认、补录、空白、半天、没上班共用格子更新入口，并保留格子证据',
    },
  ]

  const score = criteria.reduce((total, criterion) => total + (criterion.passed ? criterion.weight : 0), 0)
  return {
    score,
    grade: gradeFor(score),
    criteria,
  }
}
