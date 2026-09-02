import { getEntryCalculatedAmount } from './calculation'
import { riskFlagLabel } from './ledgerCells'
import type { RecognitionResult, VerificationItem, VerificationStatus } from '../types'

export type VerificationState = Record<string, VerificationStatus>

export function buildVerificationQueue(result: RecognitionResult): VerificationItem[] {
  const cellItems =
    result.cells
      ?.filter((cell) => {
        if (cell.columnKind === 'date' || cell.columnKind === 'dailyTotal') return false
        if (cell.riskFlags.includes('userEdited')) return false
        return cell.riskFlags.length > 0 || cell.blankConfidence < 0.95
      })
      .map((cell): VerificationItem => {
        const hasMissedDigitRisk = cell.riskFlags.includes('possibleMissedDigit')
        const hasCutRisk = cell.riskFlags.includes('cutLowConfidence')
        const amountImpact = Math.abs(cell.amount ?? 0)
        const risk =
          Math.min(1, cell.riskFlags.length * 0.18) +
          (hasMissedDigitRisk ? 0.35 : 0) +
          (hasCutRisk ? 0.3 : 0) +
          (1 - cell.cutEvidence.confidence) * 0.28 +
          Math.min(amountImpact / 200, 0.3)

        return {
          id: `cell:${cell.id}`,
          targetId: cell.id,
          kind: 'cell',
          title: `${cell.row}日 ${cell.columnLabel}${cell.rawText ? `：${cell.rawText}` : '：空白格'}`,
          detail: cell.riskFlags.length
            ? `风险：${cell.riskFlags.map((flag) => riskFlagLabel(flag)).join(' / ')}`
            : cell.note,
          risk,
          amountImpact,
          confidence: Math.min(cell.confidence, cell.cutEvidence.confidence),
          region: cell.bboxOriginal,
        }
      }) ?? []

  const uncertainItems = result.uncertainMarks.map((mark): VerificationItem => ({
    id: `uncertain:${mark.id}`,
    targetId: mark.id,
    kind: 'uncertain',
    title: `不确定字符：${mark.text}`,
    detail: `${mark.reason} 候选：${mark.candidates.join(' / ')}`,
    risk: 1 - mark.confidence + 0.3,
    amountImpact: 0,
    confidence: mark.confidence,
    region: mark.region,
  }))

  const entryItems = result.entries.map((entry): VerificationItem => {
    const amount = getEntryCalculatedAmount(result, entry) ?? 0
    const amountImpact = Math.abs(amount)
    const lowConfidenceRisk = 1 - entry.confidence
    const impactRisk = Math.min(amountImpact / 200, 1)

    return {
      id: `entry:${entry.id}`,
      targetId: entry.id,
      kind: 'entry',
      title: `${entry.rowLabel} ${entry.rawText}`,
      detail: entry.formula || entry.note || entry.label,
      risk: lowConfidenceRisk * 0.7 + impactRisk * 0.3,
      amountImpact,
      confidence: entry.confidence,
      region: entry.region,
    }
  })

  const ruleItems =
    result.columnRules?.map((rule): VerificationItem => ({
      id: `rule:${rule.id}`,
      targetId: rule.id,
      kind: 'rule',
      title: `倍率规则：${rule.label} x ${rule.multiplier}`,
      detail: `证据：${rule.evidenceText}`,
      risk: 1 - rule.confidence + 0.25,
      amountImpact: 0,
      confidence: rule.confidence,
    })) ?? []

  return [...uncertainItems, ...cellItems, ...ruleItems, ...entryItems].sort((a, b) => b.risk - a.risk)
}

export function getVerificationProgress(queue: VerificationItem[], state: VerificationState) {
  const completed = queue.filter((item) => state[item.id] && state[item.id] !== 'pending').length
  return {
    completed,
    total: queue.length,
    remaining: Math.max(queue.length - completed, 0),
  }
}

export function getNextVerificationItem(queue: VerificationItem[], state: VerificationState) {
  return queue.find((item) => !state[item.id] || state[item.id] === 'pending') ?? null
}
