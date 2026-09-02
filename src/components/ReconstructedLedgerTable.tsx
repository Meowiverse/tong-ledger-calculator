import { useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Edit3, Eye, MinusCircle, ShieldAlert } from 'lucide-react'
import { formatAmount, getEntryCalculatedAmount, summarizeRecognition } from '../lib/calculation'
import {
  buildLedgerCells,
  columnRuleForCell,
  getCuttingFeasibility,
  getLedgerColumns,
  riskFlagLabel,
} from '../lib/ledgerCells'
import type { LedgerCell, LedgerCellSemanticType, PaperTemplate, RecognitionResult } from '../types'

interface ReconstructedLedgerTableProps {
  imageUrl?: string
  paperTemplate: PaperTemplate
  result: RecognitionResult
  selectedEntryId: string
  onSelectEntry: (id: string) => void
  onUpdateCell?: (
    cellId: string,
    value: string,
    semanticType: LedgerCellSemanticType,
    nextSelectedCellId?: string,
  ) => void
}

function headerLabel(
  column: ReturnType<typeof getLedgerColumns>[number],
  result: RecognitionResult,
  paperTemplate: PaperTemplate,
) {
  if (column.kind !== 'product') return column.label
  const rule = columnRuleForCell(result, { columnId: column.id, columnLabel: column.label }, paperTemplate)
  return rule ? `${column.label} ${rule.multiplier}` : column.label
}

function semanticLabel(type: LedgerCellSemanticType) {
  const labels: Record<LedgerCellSemanticType, string> = {
    attendance: '出勤',
    blank: '空白',
    deduction: '扣款',
    directMoney: '上下货',
    note: '备注',
    quantity: '数量',
    uncertain: '待判断',
  }
  return labels[type]
}

function formatResidual(value: number | null) {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : '证据不足'
}

function cuttingMethodLabel(method: string) {
  if (method === 'projection-lines') return '本地线条切格'
  if (method === 'cnn-hybrid') return '本地 CNN + 格线融合'
  if (method === 'hybrid-model') return '本地模型 + 格线融合'
  return '模型点位拟合'
}

function amountForCell(cell: LedgerCell, result: RecognitionResult) {
  if (typeof cell.amount === 'number') return cell.amount
  return cell.entryIds.reduce((total, entryId) => {
    const entry = result.entries.find((item) => item.id === entryId)
    return total + (entry ? getEntryCalculatedAmount(result, entry) ?? 0 : 0)
  }, 0)
}

function CellButton({
  cell,
  isSelected,
  onSelect,
  result,
}: {
  cell: LedgerCell
  isSelected: boolean
  onSelect: (cell: LedgerCell) => void
  result: RecognitionResult
}) {
  const amount = amountForCell(cell, result)
  const hasContent = Boolean(cell.rawText || cell.entryIds.length)
  const isRisky = cell.riskFlags.length > 0
  const hasCutRisk = cell.riskFlags.includes('cutLowConfidence')

  if (cell.columnKind === 'date') {
    return <th>{cell.row}日</th>
  }

  return (
    <td>
      <button
        className={`reconstructed-cell-button ${isSelected ? 'is-selected' : ''} ${
          isRisky ? 'is-risky' : ''
        } ${!hasContent ? 'is-blank' : ''}`}
        type="button"
        onClick={() => onSelect(cell)}
      >
        <span>{hasContent ? cell.rawText : '空白'}</span>
        {amount ? <small>{formatAmount(amount, result.currency)}</small> : null}
        {isRisky ? (
          <em>
            {hasCutRisk
              ? '切格'
              : cell.riskFlags.includes('possibleMissedDigit')
                ? '需核'
                : '风险'}
          </em>
        ) : null}
      </button>
    </td>
  )
}

function defaultTypeForCell(cell: LedgerCell): LedgerCellSemanticType {
  if (cell.semanticType !== 'blank') return cell.semanticType
  if (cell.columnKind === 'attendance') return 'attendance'
  if (cell.columnKind === 'product') return 'quantity'
  if (cell.columnKind === 'unloading') return 'directMoney'
  if (cell.columnKind === 'deduction') return 'deduction'
  return 'blank'
}

function CellInspector({
  cell,
  currency,
  currentIndex,
  imageUrl,
  totalCells,
  onUpdateCell,
  onSelectCell,
  previousCell,
  nextCell,
  nextRiskCell,
  result,
}: {
  cell: LedgerCell
  currency: string
  currentIndex: number
  imageUrl?: string
  totalCells: number
  onUpdateCell?: (
    cellId: string,
    value: string,
    semanticType: LedgerCellSemanticType,
    nextSelectedCellId?: string,
  ) => void
  onSelectCell: (cellId: string) => void
  previousCell?: LedgerCell
  nextCell?: LedgerCell
  nextRiskCell?: LedgerCell
  result: RecognitionResult
}) {
  const [draftValue, setDraftValue] = useState(cell.rawText)
  const [semanticType, setSemanticType] = useState<LedgerCellSemanticType>(() => defaultTypeForCell(cell))
  const summary = summarizeRecognition(result)
  const confirmType = draftValue.trim()
    ? semanticType
    : cell.semanticType === 'blank'
      ? 'blank'
      : semanticType
  const nextAfterSave = nextRiskCell?.id ?? nextCell?.id ?? cell.id

  return (
    <div className="cell-inspector" aria-label="格子对照详情">
      <div className="mobile-audit-bar" role="group" aria-label="手机核查状态">
        <div>
          <span>当前合计</span>
          <strong>{formatAmount(summary.total, currency)}</strong>
        </div>
        <div>
          <span>格子</span>
          <strong>{currentIndex + 1}/{totalCells}</strong>
        </div>
      </div>
      <div className="cell-inspector-head">
        <div>
          <strong>{cell.row}日 · {cell.columnLabel}</strong>
          <span>
            {semanticLabel(cell.semanticType)} · 空白置信度 {(cell.blankConfidence * 100).toFixed(0)}% ·
            切格置信度 {(cell.cutEvidence.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <b>{typeof cell.amount === 'number' ? formatAmount(cell.amount, currency) : '未计入'}</b>
      </div>
      <div className="cell-nav-actions" aria-label="连续核查导航">
        <button
          type="button"
          disabled={!previousCell}
          onClick={() => previousCell && onSelectCell(previousCell.id)}
        >
          <ChevronLeft size={16} />
          上一格
        </button>
        <button
          type="button"
          disabled={!nextRiskCell}
          onClick={() => nextRiskCell && onSelectCell(nextRiskCell.id)}
        >
          <ShieldAlert size={16} />
          下个风险
        </button>
        <button
          type="button"
          disabled={!nextCell}
          onClick={() => nextCell && onSelectCell(nextCell.id)}
        >
          下一格
          <ChevronRight size={16} />
        </button>
      </div>
      {onUpdateCell ? (
        <div className="cell-edit-panel">
          <div className="cell-edit-actions">
            <button
              type="button"
              onClick={() => onUpdateCell(cell.id, draftValue, confirmType, nextAfterSave)}
            >
              <Check size={16} />
              确认正确
            </button>
            <button type="button" onClick={() => onUpdateCell(cell.id, '', 'blank', nextAfterSave)}>
              <MinusCircle size={16} />
              确认空白
            </button>
            <button type="button" onClick={() => onUpdateCell(cell.id, 'X', 'attendance', nextAfterSave)}>
              <Check size={16} />
              没上班
            </button>
            <button type="button" onClick={() => onUpdateCell(cell.id, '0.5', 'attendance', nextAfterSave)}>
              <Check size={16} />
              半天
            </button>
            <button type="button" onClick={() => onUpdateCell(cell.id, draftValue, 'quantity', nextAfterSave)}>
              <Edit3 size={16} />
              纸类数量
            </button>
            <button type="button" onClick={() => onUpdateCell(cell.id, draftValue, 'directMoney', nextAfterSave)}>
              <Edit3 size={16} />
              上下货金额
            </button>
            <button type="button" onClick={() => onUpdateCell(cell.id, draftValue, 'deduction', nextAfterSave)}>
              <Edit3 size={16} />
              扣款
            </button>
            <button type="button" onClick={() => onUpdateCell(cell.id, draftValue, 'note', nextAfterSave)}>
              <Edit3 size={16} />
              备注
            </button>
            <button type="button" onClick={() => onUpdateCell(cell.id, draftValue, semanticType, nextAfterSave)}>
              <Edit3 size={16} />
              保存格子
            </button>
          </div>
          <select
            aria-label="格子类型"
            value={semanticType}
            onChange={(event) => setSemanticType(event.target.value as LedgerCellSemanticType)}
          >
            <option value="quantity">纸类数量</option>
            <option value="directMoney">上下货金额</option>
            <option value="deduction">扣款</option>
            <option value="attendance">上班/半天/没上班</option>
            <option value="blank">空白</option>
            <option value="note">备注/不计入</option>
          </select>
          <input
            aria-label="格子内容"
            inputMode="decimal"
            placeholder={semanticType === 'blank' ? '确认空白无需填写' : '输入格子里的内容'}
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
          />
        </div>
      ) : null}
      {imageUrl ? <CellCropPreview cell={cell} imageUrl={imageUrl} /> : null}
      <details className="cell-evidence-details">
        <summary>
          <Eye size={15} />
          证据详情
        </summary>
        <div className="cell-evidence-grid">
          <span>格子编号</span>
          <code>{cell.id}</code>
          <span>原图位置</span>
          <code>
            x{cell.bboxOriginal.x.toFixed(1)} y{cell.bboxOriginal.y.toFixed(1)} w
            {cell.bboxOriginal.width.toFixed(1)} h{cell.bboxOriginal.height.toFixed(1)}
          </code>
          <span>裁剪证据</span>
          <code>{cell.cropRef}</code>
          <span>切格置信度</span>
          <code>{(cell.cutEvidence.confidence * 100).toFixed(0)}% · {cell.cutEvidence.level}</code>
          <span>边线偏差</span>
          <code>
            L {formatResidual(cell.cutEvidence.lineDeltas.left)} ·
            R {formatResidual(cell.cutEvidence.lineDeltas.right)} ·
            T {formatResidual(cell.cutEvidence.lineDeltas.top)} ·
            B {formatResidual(cell.cutEvidence.lineDeltas.bottom)}
          </code>
        </div>
      </details>
      <div className="cell-cut-summary">{cell.cutEvidence.reasons.join('；')}</div>
      {cell.riskFlags.length ? (
        <div className="cell-risk-list">
          {cell.riskFlags.map((risk) => (
            <span key={risk}>{riskFlagLabel(risk)}</span>
          ))}
        </div>
      ) : null}
      <p>{cell.note}</p>
    </div>
  )
}

function CellCropPreview({ cell, imageUrl }: { cell: LedgerCell; imageUrl: string }) {
  const [imageRatio, setImageRatio] = useState(4 / 3)
  const region = cell.bboxOriginal
  const width = Math.max(region.width, 1)
  const height = Math.max(region.height, 1)

  return (
    <div
      className="cell-crop-preview"
      aria-label="当前格子裁剪证据"
      style={{ aspectRatio: `${width} / ${height * imageRatio}` }}
    >
      <img
        src={imageUrl}
        alt=""
        aria-hidden="true"
        onLoad={(event) => {
          const image = event.currentTarget
          if (image.naturalWidth) setImageRatio(image.naturalHeight / image.naturalWidth)
        }}
        style={{
          width: `${(100 / width) * 100}%`,
          left: `${-(region.x / width) * 100}%`,
          top: `${-(region.y / height) * 100}%`,
        }}
      />
      <span aria-hidden="true" />
    </div>
  )
}

function MobileRowStrip({
  cells,
  result,
  selectedCell,
  onSelectEntry,
}: {
  cells: LedgerCell[]
  result: RecognitionResult
  selectedCell?: LedgerCell
  onSelectEntry: (id: string) => void
}) {
  if (!selectedCell) return null
  const rowCells = cells.filter(
    (cell) =>
      cell.row === selectedCell.row &&
      cell.columnKind !== 'date' &&
      cell.columnKind !== 'dailyTotal',
  )

  return (
    <div className="mobile-row-strip" aria-label="手机当前行核查入口">
      <div>
        <strong>{selectedCell.row}日当前行</strong>
        <span>点格子即可切换证据和底部操作</span>
      </div>
      <div className="mobile-row-grid">
        {rowCells.map((cell) => {
          const amount = amountForCell(cell, result)
          const isSelected = cell.id === selectedCell.id
          return (
            <button
              className={`${isSelected ? 'is-selected' : ''} ${
                cell.riskFlags.length ? 'is-risky' : ''
              }`}
              key={cell.id}
              type="button"
              onClick={() => onSelectEntry(cell.entryIds[0] ?? cell.id)}
            >
              <span>{cell.columnLabel}</span>
              <strong>{cell.rawText || '空白'}</strong>
              {amount ? <small>{formatAmount(amount, result.currency)}</small> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ReconstructedLedgerTable({
  imageUrl,
  paperTemplate,
  result,
  selectedEntryId,
  onSelectEntry,
  onUpdateCell,
}: ReconstructedLedgerTableProps) {
  const columns = getLedgerColumns(paperTemplate)
  const cells = useMemo(
    () => result.cells ?? buildLedgerCells(result, paperTemplate),
    [paperTemplate, result],
  )
  const cellsByRow = useMemo(() => {
    const map = new Map<number, Map<string, LedgerCell>>()
    for (const cell of cells) {
      const row = map.get(cell.row) ?? new Map<string, LedgerCell>()
      row.set(cell.columnId, cell)
      map.set(cell.row, row)
    }
    return map
  }, [cells])
  const selectedCell = cells.find(
    (cell) => cell.id === selectedEntryId || cell.entryIds.includes(selectedEntryId),
  )
  const reviewableCells = cells.filter(
    (cell) => cell.columnKind !== 'date' && cell.columnKind !== 'dailyTotal',
  )
  const selectedReviewIndex = selectedCell
    ? Math.max(0, reviewableCells.findIndex((cell) => cell.id === selectedCell.id))
    : 0
  const previousCell = selectedReviewIndex > 0 ? reviewableCells[selectedReviewIndex - 1] : undefined
  const nextCell =
    selectedReviewIndex >= 0 && selectedReviewIndex < reviewableCells.length - 1
      ? reviewableCells[selectedReviewIndex + 1]
      : undefined
  const nextRiskCell = selectedCell
    ? reviewableCells
        .slice(selectedReviewIndex + 1)
        .find((cell) => cell.riskFlags.length && !cell.riskFlags.includes('userEdited')) ??
      reviewableCells
        .slice(0, selectedReviewIndex)
        .find((cell) => cell.riskFlags.length && !cell.riskFlags.includes('userEdited'))
    : reviewableCells.find((cell) => cell.riskFlags.length && !cell.riskFlags.includes('userEdited'))
  const rows = Array.from({ length: paperTemplate.rowCount }, (_, index) => index + 1)
  const riskyCount = cells.filter(
    (cell) => cell.riskFlags.length && cell.columnKind !== 'date' && cell.columnKind !== 'dailyTotal',
  ).length
  const cutting = useMemo(
    () => getCuttingFeasibility(result, paperTemplate),
    [paperTemplate, result],
  )

  if (!cells.length) return null

  return (
    <section className="reconstructed-panel" aria-label="重绘表格对照">
      <div className="reconstructed-head">
        <div>
          <strong>重绘表格对照</strong>
          <span>{paperTemplate.name} · 自动切割 + 原图定位</span>
        </div>
        <b>{riskyCount} 格需核</b>
      </div>

      <div className={`reconstructed-feasibility is-${cutting.level}`}>
        <span>切割可行度</span>
        <strong>{cutting.score}</strong>
        <b>{cutting.label}</b>
        <em>
          偏差 {cutting.maxDelta.toFixed(1)}% · 证据 {cutting.support.distinctRows} 行/
          {cutting.support.distinctColumns} 列 · 残差 {formatResidual(cutting.residuals.max)}
          {cutting.fallback.x || cutting.fallback.y ? ' · 已回退模板' : ''}
        </em>
        <em>
          {cuttingMethodLabel(cutting.method)} · 置信度 {(cutting.confidence * 100).toFixed(0)}% ·{' '}
          {cutting.reasons.join('；')}
        </em>
      </div>

      {cutting.level !== 'good' ? (
        <div className="cutting-calibration-warning" role="alert">
          当前格子位置不能自动通过，请先按原图抽查或校准表格边界；系统不会把它当成可靠切割。
        </div>
      ) : null}

      <MobileRowStrip
        cells={cells}
        result={result}
        selectedCell={selectedCell}
        onSelectEntry={onSelectEntry}
      />

      <div className="reconstructed-scroll">
        <table className="reconstructed-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.id}>{headerLabel(column, result, paperTemplate)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((day) => (
              <tr key={day}>
                {columns.map((column) => {
                  const cell = cellsByRow.get(day)?.get(column.id)
                  if (!cell) return <td key={column.id} />
                  if (column.kind === 'dailyTotal') {
                    const rowTotal = Array.from(cellsByRow.get(day)?.values() ?? []).reduce(
                      (total, rowCell) =>
                        rowCell.columnKind === 'date' || rowCell.columnKind === 'dailyTotal'
                          ? total
                          : total + amountForCell(rowCell, result),
                      0,
                    )
                    return (
                      <td className="reconstructed-total" key={column.id}>
                        {rowTotal ? formatAmount(rowTotal, result.currency) : ''}
                      </td>
                    )
                  }
                  const isSelected = cell.id === selectedEntryId || cell.entryIds.includes(selectedEntryId)
                  return (
                    <CellButton
                      cell={cell}
                      isSelected={isSelected}
                      key={column.id}
                      onSelect={(nextCell) => onSelectEntry(nextCell.entryIds[0] ?? nextCell.id)}
                      result={result}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedCell ? (
        <CellInspector
          cell={selectedCell}
          currency={result.currency}
          key={selectedCell.id}
          currentIndex={selectedReviewIndex}
          imageUrl={imageUrl}
          totalCells={reviewableCells.length}
          onUpdateCell={onUpdateCell}
          onSelectCell={onSelectEntry}
          previousCell={previousCell}
          nextCell={nextCell}
          nextRiskCell={nextRiskCell}
          result={result}
        />
      ) : (
        <div className="cell-inspector is-empty">
          <Eye size={17} />
          点击任意格子查看原图坐标、裁剪证据和核对操作。
        </div>
      )}
    </section>
  )
}
