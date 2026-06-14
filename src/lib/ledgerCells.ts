import type {
  ImageRegion,
  LedgerCell,
  LedgerCellRiskFlag,
  LedgerCellSemanticType,
  PaperGridColumn,
  PaperTemplate,
  RecognitionResult,
  RecognizedEntry,
} from '../types'
import { getEntryCalculatedAmount } from './calculation'
import { getTemplateGrid } from './paperTemplates'

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function parseDay(rowLabel: string) {
  const match = rowLabel.match(/\d+/)
  if (!match) return null
  const day = Number(match[0])
  return Number.isFinite(day) ? day : null
}

function includesAny(text: string, candidates: string[]) {
  return candidates.some((candidate) => candidate && text.includes(candidate))
}

export function getLedgerColumns(template: PaperTemplate) {
  return getTemplateGrid(template).columns
}

export function productColumnIdForEntry(entry: RecognizedEntry, template: PaperTemplate) {
  const text = `${entry.label} ${entry.category} ${entry.note ?? ''}`
  const direct = template.productColumns.find((column) => text.includes(column.label))
  if (direct) return direct.id

  const directionalMap = [
    { words: ['左列', '第一列'], index: 0 },
    { words: ['中列', '第二列'], index: 1 },
    { words: ['右列', '第三列'], index: 2 },
  ]
  const directional = directionalMap.find((item) => includesAny(text, item.words))
  if (directional) return template.productColumns[directional.index]?.id ?? null

  return template.productColumns[0]?.id ?? null
}

export function columnIdForEntry(entry: RecognizedEntry, template: PaperTemplate) {
  const text = `${entry.label} ${entry.category} ${entry.note ?? ''}`

  if (entry.category === '出勤' || includesAny(text, ['上班', '出勤', '考勤'])) return 'attendance'
  if (template.unloadingColumnLabel && text.includes(template.unloadingColumnLabel)) {
    return 'unloading'
  }
  if (template.deductionLabel && text.includes(template.deductionLabel)) {
    return 'deduction'
  }

  return productColumnIdForEntry(entry, template)
}

export function columnRuleForCell(
  result: RecognitionResult,
  cell: Pick<LedgerCell, 'columnId' | 'columnLabel'>,
  template: PaperTemplate,
) {
  const direct = result.columnRules?.find((rule) => rule.label.includes(cell.columnLabel))
  if (direct) return direct

  const productIndex = template.productColumns.findIndex((column) => column.id === cell.columnId)
  const directionalLabels = ['左列', '中列', '右列', '第四列']
  const directionalLabel = directionalLabels[productIndex]
  if (!directionalLabel) return null

  return result.columnRules?.find((rule) => rule.label.includes(directionalLabel)) ?? null
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function offsetFor(index: number, ratios: number[]) {
  const total = sum(ratios)
  const before = sum(ratios.slice(0, index))
  return total ? (before / total) * 100 : 0
}

function sizeFor(index: number, ratios: number[]) {
  const total = sum(ratios)
  return total ? (ratios[index] / total) * 100 : 0
}

function centerRatioFor(index: number, ratios: number[]) {
  const total = sum(ratios)
  const before = sum(ratios.slice(0, index))
  return total ? (before + ratios[index] / 2) / total : 0
}

function quantile(values: number[], percentile: number) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * percentile)))
  return sorted[index]
}

function linearFit(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return null
  const n = points.length
  const sx = points.reduce((total, point) => total + point.x, 0)
  const sy = points.reduce((total, point) => total + point.y, 0)
  const sxx = points.reduce((total, point) => total + point.x * point.x, 0)
  const sxy = points.reduce((total, point) => total + point.x * point.y, 0)
  const denominator = n * sxx - sx * sx
  if (Math.abs(denominator) < 0.0001) return null
  const slope = (n * sxy - sx * sy) / denominator
  const intercept = (sy - slope * sx) / n
  return { intercept, slope }
}

function mean(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null
}

function clampRegion(region: ImageRegion): ImageRegion {
  const x = Math.max(0, Math.min(99, region.x))
  const y = Math.max(0, Math.min(99, region.y))
  return {
    x,
    y,
    width: Math.max(1, Math.min(100 - x, region.width)),
    height: Math.max(1, Math.min(100 - y, region.height)),
  }
}

export interface LedgerTableFit {
  region: ImageRegion
  fixedRegion: ImageRegion
  support: {
    rowPoints: number
    columnPoints: number
    distinctRows: number
    distinctColumns: number
  }
  residuals: {
    x: number | null
    y: number | null
    max: number | null
  }
  fallback: {
    x: boolean
    y: boolean
  }
}

export function getLedgerTableFit(result: RecognitionResult, template: PaperTemplate): LedgerTableFit {
  const grid = getTemplateGrid(template)
  const fallback = grid.tableRegion
  const columnIndexById = new Map(grid.columns.map((column, index) => [column.id, index]))
  const xPoints: Array<{ x: number; y: number }> = []
  const yPoints: Array<{ x: number; y: number }> = []
  const distinctColumnIndexes = new Set<number>()
  const distinctRows = new Set<number>()

  for (const entry of result.entries) {
    const day = parseDay(entry.rowLabel)
    const columnId = entry.cellId?.replace(/^r\d+-/, '') || columnIdForEntry(entry, template)
    const columnIndex = columnId ? columnIndexById.get(columnId) : undefined
    const centerX = entry.region.x + entry.region.width / 2
    const centerY = entry.region.y + entry.region.height / 2

    if (day && day >= 1 && day <= grid.rows) {
      yPoints.push({ x: day - 1, y: centerY })
      distinctRows.add(day)
    }
    if (typeof columnIndex === 'number') {
      xPoints.push({ x: centerRatioFor(columnIndex, grid.columnRatios), y: centerX })
      distinctColumnIndexes.add(columnIndex)
    }
  }

  const xFit = linearFit(xPoints)
  const yFit = linearFit(yPoints)
  const usableXFit =
    distinctColumnIndexes.size >= 2 &&
    xFit &&
    Number.isFinite(xFit.intercept) &&
    Number.isFinite(xFit.slope) &&
    xFit.slope > 30 &&
    xFit.slope <= 98
      ? xFit
      : null
  const usableYFit =
    distinctRows.size >= 6 &&
    yFit &&
    Number.isFinite(yFit.intercept) &&
    Number.isFinite(yFit.slope) &&
    yFit.slope > 1 &&
    yFit.slope <= 5
      ? yFit
      : null
  const x =
    usableXFit
      ? usableXFit.intercept
      : fallback.x
  const width =
    usableXFit
      ? usableXFit.slope
      : fallback.width

  let y = fallback.y
  let height = fallback.height
  if (usableYFit) {
    const originCandidates = yPoints
      .map((point) => point.y - (grid.headerRows + point.x + 0.5) * usableYFit.slope)
      .filter(Number.isFinite)
    const fittedTop = quantile(originCandidates, 0.05)
    if (typeof fittedTop === 'number') {
      y = fittedTop
      height = usableYFit.slope * (grid.rows + grid.headerRows)
    }
  }

  const region = clampRegion({ x, y, width, height })
  const rowHeight = region.height / (grid.rows + grid.headerRows)
  const xResidual = usableXFit
    ? mean(xPoints.map((point) => Math.abs(point.y - (region.x + point.x * region.width))))
    : null
  const yResidual = usableYFit
    ? mean(
        yPoints.map((point) =>
          Math.abs(point.y - (region.y + (grid.headerRows + point.x + 0.5) * rowHeight)),
        ),
      )
    : null
  const finiteResiduals = [xResidual, yResidual].filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )

  return {
    region,
    fixedRegion: fallback,
    support: {
      rowPoints: yPoints.length,
      columnPoints: xPoints.length,
      distinctRows: distinctRows.size,
      distinctColumns: distinctColumnIndexes.size,
    },
    residuals: {
      x: xResidual,
      y: yResidual,
      max: finiteResiduals.length ? Math.max(...finiteResiduals) : null,
    },
    fallback: {
      x: !usableXFit,
      y: !usableYFit,
    },
  }
}

export function getLedgerTableRegion(result: RecognitionResult, template: PaperTemplate): ImageRegion {
  return getLedgerTableFit(result, template).region
}

export function getFixedTemplateTableRegion(template: PaperTemplate): ImageRegion {
  return getTemplateGrid(template).tableRegion
}

export function getCuttingFeasibility(result: RecognitionResult, template: PaperTemplate) {
  const fixedRegion = getFixedTemplateTableRegion(template)
  const fit = getLedgerTableFit(result, template)
  const calibratedRegion = fit.region
  const deltas = {
    x: Math.abs(calibratedRegion.x - fixedRegion.x),
    y: Math.abs(calibratedRegion.y - fixedRegion.y),
    width: Math.abs(calibratedRegion.width - fixedRegion.width),
    height: Math.abs(calibratedRegion.height - fixedRegion.height),
  }
  const maxDelta = Math.max(deltas.x, deltas.y, deltas.width, deltas.height)
  const fallbackCount = Number(fit.fallback.x) + Number(fit.fallback.y)
  const rowShortfall = Math.max(0, 8 - fit.support.distinctRows)
  const columnShortfall = Math.max(0, 2 - fit.support.distinctColumns)
  const residualPenalty = (fit.residuals.max ?? 3.5) * 9
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        100 -
          maxDelta * 8 -
          fallbackCount * 18 -
          rowShortfall * 4 -
          columnShortfall * 12 -
          residualPenalty,
      ),
    ),
  )
  const supportOk = fit.support.distinctRows >= 8 && fit.support.distinctColumns >= 2
  const residualOk = typeof fit.residuals.max === 'number' && fit.residuals.max <= 1.8
  const fallbackUsed = fit.fallback.x || fit.fallback.y
  const level =
    supportOk && residualOk && !fallbackUsed && maxDelta <= 2.5
      ? 'good'
      : score >= 65 && maxDelta <= 6 && fit.support.distinctRows >= 4
        ? 'review'
        : 'calibrate'
  const label =
    level === 'good'
      ? '可直接切割'
      : level === 'review'
        ? '建议抽查'
        : '需先校准'

  return {
    fixedRegion,
    calibratedRegion,
    deltas,
    maxDelta,
    support: fit.support,
    residuals: fit.residuals,
    fallback: fit.fallback,
    score,
    level,
    label,
  }
}

function regionForCell(
  day: number,
  columnIndex: number,
  template: PaperTemplate,
  tableRegion: ImageRegion,
): ImageRegion {
  const grid = getTemplateGrid(template)
  const yRatios = [grid.headerRows || 1, ...grid.rowRatios]
  const y = tableRegion.y + (offsetFor(day, yRatios) / 100) * tableRegion.height
  const height = (sizeFor(day, yRatios) / 100) * tableRegion.height
  const x = tableRegion.x + (offsetFor(columnIndex, grid.columnRatios) / 100) * tableRegion.width
  const width = (sizeFor(columnIndex, grid.columnRatios) / 100) * tableRegion.width

  return clampRegion({ x, y, width, height })
}

function semanticTypeForColumn(column: PaperGridColumn): LedgerCellSemanticType {
  if (column.kind === 'attendance') return 'attendance'
  if (column.kind === 'product') return 'quantity'
  if (column.kind === 'unloading') return 'directMoney'
  if (column.kind === 'deduction') return 'deduction'
  if (column.kind === 'date' || column.kind === 'dailyTotal') return 'note'
  return 'uncertain'
}

function risksForEntry(entry: RecognizedEntry): LedgerCellRiskFlag[] {
  const risks: LedgerCellRiskFlag[] = []
  if (entry.confidence < 0.7) risks.push('lowConfidence')
  if (entry.region.x <= 3 || entry.region.x + entry.region.width >= 97) risks.push('nearBorder')
  if (entry.region.width > 10 || entry.region.height > 6) risks.push('crossCell')
  if (`${entry.rawText}${entry.normalizedText}`.includes('0.5')) risks.push('ambiguousHalfDay')
  if (`${entry.rawText}${entry.normalizedText}`.includes('元')) risks.push('moneyUnit')
  return risks
}

function uniqueRisks(risks: LedgerCellRiskFlag[]) {
  return Array.from(new Set(risks))
}

function baseCell(
  day: number,
  column: PaperGridColumn,
  columnIndex: number,
  template: PaperTemplate,
  tableRegion: ImageRegion,
): LedgerCell {
  const region = regionForCell(day, columnIndex, template, tableRegion)
  return {
    id: `r${day}-${column.id}`,
    row: day,
    columnId: column.id,
    columnLabel: column.label,
    columnKind: column.kind,
    bboxOriginal: region,
    bboxWarped: region,
    cropRef: `cell:r${day}-${column.id}`,
    rawText: '',
    normalizedText: '',
    semanticType: 'blank',
    blankConfidence: column.kind === 'date' || column.kind === 'dailyTotal' ? 1 : 0.9,
    confidence: 0.9,
    riskFlags: [],
    entryIds: [],
    amount: null,
    note: '未识别到内容，可点击原图格子确认空白。',
  }
}

export function buildLedgerCells(result: RecognitionResult, template: PaperTemplate): LedgerCell[] {
  const grid = getTemplateGrid(template)
  const tableRegion = getLedgerTableRegion(result, template)
  const existingCells = new Map((result.cells ?? []).map((cell) => [cell.id, cell]))
  const cells = new Map<string, LedgerCell>()

  for (let day = 1; day <= grid.rows; day += 1) {
    grid.columns.forEach((column, columnIndex) => {
      const base = baseCell(day, column, columnIndex, template, tableRegion)
      const existing = existingCells.get(base.id)
      cells.set(
        base.id,
        existing
          ? {
              ...base,
              bboxOriginal: existing.bboxOriginal ?? base.bboxOriginal,
              bboxWarped: existing.bboxWarped ?? base.bboxWarped,
              cropRef: existing.cropRef ?? base.cropRef,
              riskFlags: existing.riskFlags.includes('userEdited') ? ['userEdited'] : [],
              note: existing.riskFlags.includes('userEdited') ? existing.note : base.note,
            }
          : base,
      )
    })
  }

  const resultWithoutCells = { ...result, cells: undefined }
  for (const entry of result.entries) {
    const day = parseDay(entry.rowLabel)
    if (!day || day < 1 || day > grid.rows) continue
    const columnId = entry.cellId?.replace(/^r\d+-/, '') || columnIdForEntry(entry, template)
    if (!columnId) continue
    const cellId = `r${day}-${columnId}`
    const current = cells.get(cellId)
    if (!current) continue

    const amount = getEntryCalculatedAmount(resultWithoutCells, entry)
    const risks = uniqueRisks([
      ...current.riskFlags.filter((flag) => flag === 'userEdited'),
      ...risksForEntry(entry),
    ])
    cells.set(cellId, {
      ...current,
      rawText: [current.rawText, entry.rawText].filter(Boolean).join(' / '),
      normalizedText: [current.normalizedText, entry.normalizedText].filter(Boolean).join(' / '),
      semanticType:
        current.semanticType === 'blank'
          ? semanticTypeForColumn({
              id: current.columnId,
              label: current.columnLabel,
              kind: current.columnKind,
            })
          : current.semanticType,
      blankConfidence: 0,
      confidence: Math.min(current.confidence, entry.confidence),
      riskFlags: risks,
      entryIds: Array.from(new Set([...current.entryIds, entry.id])),
      amount: roundMoney((current.amount ?? 0) + (amount ?? 0)),
      note: entry.note || entry.formula || current.note,
    })
  }

  return Array.from(cells.values()).map((cell) => {
    const existing = existingCells.get(cell.id)
    if (
      existing?.riskFlags.includes('userEdited') &&
      !cell.rawText &&
      (existing.semanticType === 'blank' ||
        existing.semanticType === 'attendance' ||
        existing.semanticType === 'note')
    ) {
      return {
        ...cell,
        rawText: existing.rawText,
        normalizedText: existing.normalizedText,
        semanticType: existing.semanticType,
        blankConfidence: existing.semanticType === 'blank' ? 1 : 0,
        confidence: 1,
        riskFlags: uniqueRisks([...cell.riskFlags, 'userEdited']),
        note: existing.note,
      }
    }

    if (cell.rawText || cell.columnKind === 'date' || cell.columnKind === 'dailyTotal') return cell
    const possibleMissedDigit =
      cell.columnKind === 'product' || cell.columnKind === 'unloading' || cell.columnKind === 'deduction'
    return {
      ...cell,
      riskFlags: possibleMissedDigit ? uniqueRisks([...cell.riskFlags, 'possibleMissedDigit']) : cell.riskFlags,
      note: possibleMissedDigit
        ? '空白格仍需可核对；若裁剪图中有数字，请直接补录。'
        : cell.note,
    }
  })
}

function entryFromEditedCell(
  cell: LedgerCell,
  template: PaperTemplate,
  result: RecognitionResult,
): RecognizedEntry | null {
  if (!cell.rawText.trim()) return null
  if (cell.semanticType === 'blank' || cell.semanticType === 'note') return null
  if (cell.semanticType === 'attendance') return null

  const numericValue = Number(cell.normalizedText || cell.rawText)
  if (!Number.isFinite(numericValue)) return null

  const product = template.productColumns.find((column) => column.id === cell.columnId)
  const columnRule = columnRuleForCell(result, cell, template)
  const multiplier =
    cell.semanticType === 'quantity' && typeof product?.unitPrice === 'number'
      ? product.unitPrice
      : cell.semanticType === 'quantity' && typeof columnRule?.multiplier === 'number'
        ? columnRule.multiplier
      : cell.semanticType === 'directMoney' || cell.semanticType === 'deduction'
        ? 1
        : null
  const signedValue = cell.semanticType === 'deduction' && numericValue > 0 ? -numericValue : numericValue

  return {
    id: `cell-entry:${cell.id}`,
    cellId: cell.id,
    label: `${cell.row}日${cell.columnLabel}`,
    rowLabel: `${cell.row}日`,
    rawText: cell.rawText,
    normalizedText: cell.normalizedText || cell.rawText,
    amount: signedValue,
    rawValue: signedValue,
    multiplier,
    calculatedAmount: typeof multiplier === 'number' ? roundMoney(signedValue * multiplier) : signedValue,
    formula:
      typeof multiplier === 'number' && multiplier !== 1
        ? `${signedValue} x ${multiplier}`
        : '用户按格子确认',
    category: cell.columnLabel,
    confidence: 1,
    region: cell.bboxOriginal,
    anchor: null,
    note: '用户从固定格子对照补录。',
  }
}

export function normalizeResultCells(
  result: RecognitionResult,
  template: PaperTemplate,
): RecognitionResult {
  const cells = buildLedgerCells(result, template)
  return { ...result, cells }
}

export function updateLedgerCell(
  result: RecognitionResult,
  template: PaperTemplate,
  cellId: string,
  patch: Partial<Pick<LedgerCell, 'rawText' | 'normalizedText' | 'semanticType' | 'note'>>,
): RecognitionResult {
  const cells = buildLedgerCells(result, template).map((cell) => {
    if (cell.id !== cellId) return cell
    const rawText = patch.rawText ?? cell.rawText
    return {
      ...cell,
      ...patch,
      rawText,
      normalizedText: patch.normalizedText ?? rawText,
      blankConfidence: patch.semanticType === 'blank' ? 1 : 0,
      confidence: 1,
      riskFlags: uniqueRisks([...cell.riskFlags.filter((flag) => flag !== 'possibleMissedDigit'), 'userEdited']),
      note: patch.note ?? '用户已按格子对照修正。',
    }
  })

  const editedEntryIds = new Set(cells.map((cell) => `cell-entry:${cell.id}`))
  const untouchedEntries = result.entries.filter((entry) => {
    if (editedEntryIds.has(entry.id)) return false
    const day = parseDay(entry.rowLabel)
    const columnId = entry.cellId?.replace(/^r\d+-/, '') || columnIdForEntry(entry, template)
    return `r${day}-${columnId}` !== cellId
  })
  const editedEntries = cells
    .filter((cell) => cell.riskFlags.includes('userEdited'))
    .map((cell) => entryFromEditedCell(cell, template, result))
    .filter((entry): entry is RecognizedEntry => Boolean(entry))

  return {
    ...result,
    computedTotal: null,
    entries: [...untouchedEntries, ...editedEntries],
    cells,
  }
}
