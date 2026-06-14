import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { SAMPLE_CASES } from '../data/sampleCases'
import { SAMPLE_RECOGNITION } from '../data/sampleRecognition'
import { normalizeResultCells } from './ledgerCells'
import { DEFAULT_PAPER_TEMPLATE } from './paperTemplates'
import { evaluateSampleBenchmark, evaluateSampleCaseBenchmark } from './benchmark'
import { evaluateMobileAuditUx } from './uxScore'

function fileHash(filePath: string) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

describe('evaluateSampleBenchmark', () => {
  it('passes the calibrated sample recognition result', () => {
    const evaluation = evaluateSampleBenchmark(SAMPLE_RECOGNITION)

    expect(evaluation.passed).toBe(true)
    expect(evaluation.actualTotal).toBe(2860.38)
    expect(evaluation.totalError).toBe(0)
    expect(evaluation.matchedEntries).toBe(evaluation.expectedEntries)
  })

  it('requires every sample image case to pass at 100 percent', () => {
    expect(SAMPLE_CASES.length).toBeGreaterThanOrEqual(3)
    expect(new Set(SAMPLE_CASES.map((sampleCase) => sampleCase.imageUrl)).size).toBe(
      SAMPLE_CASES.length,
    )
    const sampleFilePaths = SAMPLE_CASES.map((sampleCase) =>
      path.resolve(process.cwd(), 'public', sampleCase.imageUrl),
    )
    const sampleHashes = new Set(sampleFilePaths.map(fileHash))

    expect(sampleFilePaths.every((filePath) => existsSync(filePath))).toBe(true)
    expect(sampleHashes.size).toBe(SAMPLE_CASES.length)

    for (const sampleCase of SAMPLE_CASES) {
      expect(sampleCase.imageUrl, `${sampleCase.name} image URL`).toMatch(
        /^samples\/.+\.(png|jpg|jpeg|webp)$/i,
      )

      const normalizedResult = normalizeResultCells(sampleCase.expectedResult, DEFAULT_PAPER_TEMPLATE)
      const evaluation = evaluateSampleCaseBenchmark(normalizedResult, sampleCase)
      const uxEvaluation = evaluateMobileAuditUx(normalizedResult)

      expect(evaluation.passed, `${sampleCase.name} benchmark must pass`).toBe(true)
      expect(evaluation.totalScore, `${sampleCase.name} benchmark score`).toBe(100)
      expect(evaluation.totalError, `${sampleCase.name} total error`).toBe(0)
      expect(evaluation.matchedEntries, `${sampleCase.name} matched entries`).toBe(
        evaluation.expectedEntries,
      )
      expect(uxEvaluation.grade, `${sampleCase.name} UX grade`).toBe('S')
      expect(uxEvaluation.score, `${sampleCase.name} UX score`).toBe(100)
    }
  })

  it('flags wrong totals and wrong row values', () => {
    const wrongResult = {
      ...SAMPLE_RECOGNITION,
      computedTotal: 2859.5,
      entries: SAMPLE_RECOGNITION.entries.map((entry) =>
        entry.id === 'd4-b'
          ? {
              ...entry,
              rawText: '140',
              normalizedText: '140',
              amount: 140,
              rawValue: 140,
              calculatedAmount: 12.32,
            }
          : entry,
      ),
    }

    const evaluation = evaluateSampleBenchmark(wrongResult)

    expect(evaluation.passed).toBe(false)
    expect(evaluation.totalError).toBeCloseTo(-0.88)
    expect(evaluation.findings.some((finding) => finding.text.includes('期望 150，实际 140'))).toBe(
      true,
    )
  })
})
