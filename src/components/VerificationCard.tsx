import { useMemo, useState } from 'react'
import { Check, Edit3, RotateCcw, SkipForward, X } from 'lucide-react'
import { formatAmount, getEntryCalculatedAmount } from '../lib/calculation'
import { riskFlagLabel } from '../lib/ledgerCells'
import type { RecognitionResult, VerificationItem } from '../types'

interface VerificationCardProps {
  canUndo: boolean
  item: VerificationItem | null
  notice: string
  progress: {
    completed: number
    total: number
    remaining: number
  }
  result: RecognitionResult
  onConfirm: (itemId: string) => void
  onCorrectValue: (itemId: string, targetId: string, value: string) => void
  onSkip: (itemId: string) => void
  onUndo: () => void
}

export function VerificationCard({
  canUndo,
  item,
  notice,
  progress,
  result,
  onConfirm,
  onCorrectValue,
  onSkip,
  onUndo,
}: VerificationCardProps) {
  const selectedEntry = result.entries.find((entry) => entry.id === item?.targetId)
  const selectedMark = result.uncertainMarks.find((mark) => mark.id === item?.targetId)
  const nearbyEntry = useMemo(() => {
    if (!selectedMark) return undefined
    return result.entries.find(
      (entry) =>
        Math.abs(entry.region.x - selectedMark.region.x) < 1 &&
        Math.abs(entry.region.y - selectedMark.region.y) < 1,
    )
  }, [result.entries, selectedMark])
  const selectedCell = result.cells?.find(
    (cell) =>
      cell.id === item?.targetId ||
      Boolean(selectedEntry?.cellId && cell.id === selectedEntry.cellId) ||
      Boolean(selectedEntry && cell.entryIds.includes(selectedEntry.id)) ||
      Boolean(nearbyEntry && cell.entryIds.includes(nearbyEntry.id)),
  )
  const displayValue =
    selectedMark?.text ?? selectedEntry?.rawText ?? nearbyEntry?.rawText ?? selectedCell?.rawText ?? ''
  const locationLabel =
    selectedEntry?.label ??
    nearbyEntry?.label ??
    (selectedCell ? `${selectedCell.row}日${selectedCell.columnLabel}` : item?.title) ??
    ''
  const candidates = selectedMark?.candidates ?? []
  const targetEntry = selectedEntry ?? nearbyEntry
  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState(displayValue)

  if (!item) {
    return (
      <section className="verification-card is-done">
        <div className="done-copy">
          <Check size={22} />
          <div>
            <strong>全部核对完成</strong>
            <p>最终合计已经按你的确认重新计算。</p>
          </div>
        </div>
        {canUndo ? (
          <button className="undo-button" type="button" onClick={onUndo}>
            <RotateCcw size={16} />
            撤销上一步
          </button>
        ) : null}
      </section>
    )
  }

  const currentNumber = Math.min(progress.completed + 1, progress.total)
  const progressPercent = progress.total ? (progress.completed / progress.total) * 100 : 100
  const currentAmount = targetEntry ? getEntryCalculatedAmount(result, targetEntry) : null
  const alternative = candidates.find((value) => value !== displayValue)
  const alternativeNumber = alternative ? Number(alternative) : Number.NaN
  const rawValue = targetEntry?.rawValue ?? targetEntry?.amount
  const multiplier =
    typeof targetEntry?.multiplier === 'number'
      ? targetEntry.multiplier
      : result.columnRules?.find((rule) => targetEntry?.label.includes(rule.label))?.multiplier
  const alternativeAmount =
    Number.isFinite(alternativeNumber) && typeof multiplier === 'number'
      ? alternativeNumber * multiplier
      : Number.isFinite(alternativeNumber) && typeof rawValue === 'number' && currentAmount === rawValue
        ? alternativeNumber
        : null
  const alternativeDelta =
    typeof currentAmount === 'number' && typeof alternativeAmount === 'number'
      ? alternativeAmount - currentAmount
      : null

  return (
    <section className="verification-card">
      <div className="verification-head">
        <div>
          <strong>正在核对 {currentNumber}/{progress.total}</strong>
          <span>剩余 {Math.max(progress.remaining - 1, 0)} 项</span>
        </div>
        {canUndo ? (
          <button className="undo-button" type="button" onClick={onUndo}>
            <RotateCcw size={15} />
            撤销
          </button>
        ) : null}
      </div>
      <div className="review-progress" aria-label={`已完成 ${progress.completed} 处`}>
        <span style={{ width: `${progressPercent}%` }} />
      </div>

      {notice ? <div className="review-notice" role="status">{notice}</div> : null}

      <div className="risk-card">
        <span className="risk-kicker">AI 识别</span>
        <h3>{displayValue || (selectedCell ? '空白格' : '无法确定')}</h3>
        {candidates.length > 1 ? (
          <p className="candidate-copy">
            {locationLabel}字迹较模糊，也可能是 {candidates.filter((value) => value !== displayValue).join(' 或 ')}
          </p>
        ) : (
          <p className="candidate-copy">
            {locationLabel}，请对照上方放大图确认。
            {selectedCell?.riskFlags.length
              ? ` 风险：${selectedCell.riskFlags.map((flag) => riskFlagLabel(flag)).join(' / ')}`
              : ''}
          </p>
        )}
        {typeof alternativeDelta === 'number' && alternative ? (
          <p className="impact-copy">
            若改为 {alternative}，合计将
            {alternativeDelta >= 0 ? '增加' : '减少'} {formatAmount(Math.abs(alternativeDelta), result.currency)}
          </p>
        ) : null}
        {selectedCell?.cutEvidence.reasons.length ? (
          <p className="impact-copy">
            本地切格提醒：{Math.round(selectedCell.cutEvidence.confidence * 100)}% · {selectedCell.cutEvidence.reasons.join('；')}
          </p>
        ) : null}
      </div>

      {isEditing ? (
        <div className="correction-editor">
          <label htmlFor="corrected-value">输入图片中的正确数字</label>
          {candidates.length ? (
            <div className="candidate-buttons">
              {candidates.map((candidate) => (
                <button key={candidate} type="button" onClick={() => setDraftValue(candidate)}>
                  {candidate}
                </button>
              ))}
            </div>
          ) : null}
          <div className="correction-row">
            <input
              id="corrected-value"
              inputMode="decimal"
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              autoFocus
            />
            <button
              type="button"
              className="save-correction"
              disabled={!draftValue.trim()}
              onClick={() => onCorrectValue(item.id, item.targetId, draftValue)}
            >
              <Check size={17} />
              保存
            </button>
          </div>
          <button className="cancel-correction" type="button" onClick={() => setIsEditing(false)}>
            <X size={15} />
            取消修改
          </button>
        </div>
      ) : (
        <div className="verification-actions">
          <button type="button" className="verify-button confirm" onClick={() => onConfirm(item.id)}>
            <Check size={19} />
            是 {displayValue}
          </button>
          <button type="button" className="verify-button edit" onClick={() => setIsEditing(true)}>
            <Edit3 size={18} />
            改成其他数字
          </button>
          <button type="button" className="verify-button skip" onClick={() => onSkip(item.id)}>
            <SkipForward size={17} />
            稍后核对
          </button>
          <p className="action-hint">确认后自动查看下一处，可随时撤销。</p>
        </div>
      )}
    </section>
  )
}
