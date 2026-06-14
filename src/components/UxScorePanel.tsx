import { evaluateMobileAuditUx } from '../lib/uxScore'
import type { PaperTemplate, RecognitionResult } from '../types'

interface UxScorePanelProps {
  paperTemplate: PaperTemplate
  result: RecognitionResult
}

export function UxScorePanel({ paperTemplate, result }: UxScorePanelProps) {
  const evaluation = evaluateMobileAuditUx(result, paperTemplate)

  return (
    <section className={`ux-score-panel grade-${evaluation.grade}`} aria-label="UX 评分子 AI">
      <div className="ux-score-head">
        <div>
          <span>UX 评分子 AI</span>
          <strong>{evaluation.grade} 级</strong>
        </div>
        <b>{evaluation.score}/100</b>
      </div>
      <div className="ux-score-list">
        {evaluation.criteria.map((criterion) => (
          <div className={criterion.passed ? 'is-passed' : 'is-failed'} key={criterion.id}>
            <span>{criterion.label}</span>
            <strong>{criterion.passed ? criterion.weight : 0}/{criterion.weight}</strong>
            <small>{criterion.detail}</small>
          </div>
        ))}
      </div>
    </section>
  )
}
