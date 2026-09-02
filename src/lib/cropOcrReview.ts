import { fuseExternalOcrTokens } from './ocrFusion'
import { executeCalculationProgram, normalizeRecognitionResult } from './program'
import type { ExternalOcrToken, RecognitionResult, VisualExtractionResult } from '../types'

function extractionFromResult(result: RecognitionResult): VisualExtractionResult | null {
  if (!result.visualTokens?.length) return null

  return {
    title: result.title,
    sourceType: result.sourceType,
    summary: result.summary,
    currency: result.currency,
    overallConfidence: result.overallConfidence,
    tokens: result.visualTokens,
    extractedText: result.extractedText,
    auditNotes: result.auditNotes,
  }
}

function mergeAuditNotes(base: string[], extra: string[]) {
  return Array.from(new Set([...base, ...extra]))
}

export function applyCropOcrReview(
  result: RecognitionResult,
  externalTokens: ExternalOcrToken[],
): RecognitionResult {
  const extraction = extractionFromResult(result)
  if (!extraction || !result.calculationProgram || !externalTokens.length) return result

  const fusion = fuseExternalOcrTokens(extraction, externalTokens)
  const recalculated = executeCalculationProgram(fusion.extraction, result.calculationProgram)

  return normalizeRecognitionResult({
    ...result,
    ...recalculated,
    calculationProgram: result.calculationProgram,
    visualTokens: fusion.extraction.tokens,
    auditNotes: mergeAuditNotes(recalculated.auditNotes, fusion.extraction.auditNotes),
  })
}
