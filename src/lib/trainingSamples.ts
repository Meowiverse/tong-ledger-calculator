import { cropImageRegion } from './image'
import type { LedgerCell, LedgerCellSemanticType, RecognitionResult } from '../types'

const CELL_TRAINING_SAMPLES_KEY = 'tong-ledger-cell-training-samples-v1'
const MAX_CELL_TRAINING_SAMPLES = 500

export interface CellTrainingSample {
  id: string
  createdAt: string
  cellId: string
  row: number
  columnId: string
  columnLabel: string
  columnKind: string
  label: string
  semanticType: LedgerCellSemanticType
  previousRawText: string
  previousNormalizedText: string
  previousConfidence: number
  cutConfidence: number
  riskFlags: string[]
  cropDataUrl: string
  sourceTitle: string
  sourceType: string
}

export function loadCellTrainingSamples(): CellTrainingSample[] {
  try {
    const raw = localStorage.getItem(CELL_TRAINING_SAMPLES_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as CellTrainingSample[]) : []
  } catch {
    return []
  }
}

export function saveCellTrainingSample(sample: CellTrainingSample) {
  const nextSamples = [sample, ...loadCellTrainingSamples()]
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, MAX_CELL_TRAINING_SAMPLES)
  localStorage.setItem(CELL_TRAINING_SAMPLES_KEY, JSON.stringify(nextSamples))
  return nextSamples
}

export async function captureCellTrainingSample({
  cell,
  imageDataUrl,
  label,
  result,
  semanticType,
}: {
  cell: LedgerCell
  imageDataUrl: string
  label: string
  result: RecognitionResult
  semanticType: LedgerCellSemanticType
}) {
  if (!imageDataUrl) return null
  const cropDataUrl = await cropImageRegion(imageDataUrl, cell.bboxOriginal, 0.2)
  return saveCellTrainingSample({
    id: `${Date.now()}-${cell.id}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    cellId: cell.id,
    row: cell.row,
    columnId: cell.columnId,
    columnLabel: cell.columnLabel,
    columnKind: cell.columnKind,
    label,
    semanticType,
    previousRawText: cell.rawText,
    previousNormalizedText: cell.normalizedText,
    previousConfidence: cell.confidence,
    cutConfidence: cell.cutEvidence.confidence,
    riskFlags: cell.riskFlags,
    cropDataUrl,
    sourceTitle: result.title,
    sourceType: result.sourceType,
  })
}
