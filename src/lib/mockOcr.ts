import { SAMPLE_RECOGNITION } from '../data/sampleRecognition'
import type {
  CalculationProgram,
  CropOcrReading,
  CropOcrTask,
  RecognitionResult,
  VisualExtractionResult,
} from '../types'
import { normalizeResultCells } from './ledgerCells'
import { DEFAULT_PAPER_TEMPLATE } from './paperTemplates'

function multiplierForLabel(label: string) {
  if (label.includes('左列')) return 0.1
  if (label.includes('中列')) return 0.088
  if (label.includes('右列')) return 0.05
  return 1
}

function columnLabelForEntry(label: string) {
  if (label.includes('左列')) return '左列'
  if (label.includes('中列')) return '中列'
  if (label.includes('右列')) return '右列'
  return '其他'
}

const SAMPLE_CELLS = normalizeResultCells(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE).cells ?? []
const TEXT_BY_CELL_ID = new Map(
  SAMPLE_CELLS.filter((cell) => cell.rawText.trim()).map((cell) => [cell.id, cell.rawText]),
)

export function buildMockVisualExtraction(): VisualExtractionResult {
  return {
    title: SAMPLE_RECOGNITION.title,
    sourceType: SAMPLE_RECOGNITION.sourceType,
    summary: 'mock 视觉提取结果',
    currency: SAMPLE_RECOGNITION.currency,
    overallConfidence: 0.8,
    tokens: SAMPLE_RECOGNITION.entries.map((entry) => ({
      id: `token:${entry.id}`,
      kind: 'number' as const,
      label: entry.label,
      rowLabel: entry.rowLabel,
      columnLabel: columnLabelForEntry(entry.label),
      rawText: entry.rawText,
      normalizedText: entry.normalizedText,
      numericValue: entry.amount,
      candidates: [{ text: entry.rawText, confidence: entry.confidence }],
      confidence: entry.confidence,
      region: entry.region,
      anchor: entry.anchor ?? null,
      note: entry.note ?? '',
    })),
    extractedText: SAMPLE_RECOGNITION.extractedText,
    auditNotes: ['mock visual extraction'],
  }
}

export function buildMockCalculationProgram(): CalculationProgram {
  return {
    dslVersion: 'tong-ledger-dsl/v1',
    title: SAMPLE_RECOGNITION.title,
    sourceType: SAMPLE_RECOGNITION.sourceType,
    summary: 'mock 计算 DSL',
    currency: SAMPLE_RECOGNITION.currency,
    calculationFormula: SAMPLE_RECOGNITION.calculationFormula || '',
    columnRules: SAMPLE_RECOGNITION.columnRules || [],
    terms: SAMPLE_RECOGNITION.entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      rowLabel: entry.rowLabel,
      sourceTokenIds: [`token:${entry.id}`],
      rawText: entry.rawText,
      normalizedText: entry.normalizedText,
      rawValue: entry.amount,
      multiplier: multiplierForLabel(entry.label),
      include: true,
      category: entry.category,
      confidence: entry.confidence,
      formula: `${entry.amount} x ${multiplierForLabel(entry.label)}`,
      note: entry.note ?? '',
    })),
    uncertainMarks: SAMPLE_RECOGNITION.uncertainMarks,
    extractedText: SAMPLE_RECOGNITION.extractedText,
    auditNotes: ['mock calculation program'],
  }
}

export function buildMockRecognition(stage: 'audit' | 'reconcile'): RecognitionResult {
  return {
    ...SAMPLE_RECOGNITION,
    summary: stage === 'audit' ? 'mock audit result' : 'mock reconcile result',
    overallConfidence: stage === 'audit' ? 0.81 : 0.83,
    auditNotes: [...SAMPLE_RECOGNITION.auditNotes, `mock ${stage}`],
  }
}

export function buildMockCropReadings(tasks: CropOcrTask[]): {
  auditNotes: string[]
  readings: CropOcrReading[]
} {
  return {
    auditNotes: ['mock crop ocr'],
    readings: tasks.map((task) => ({
      cropRef: task.cropRef,
      text: TEXT_BY_CELL_ID.get(task.cellId) ?? '',
      confidence: TEXT_BY_CELL_ID.get(task.cellId)?.trim() ? 0.81 : 0.52,
      kind: TEXT_BY_CELL_ID.get(task.cellId)?.trim() ? 'number' : 'text',
    })),
  }
}
