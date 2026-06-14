import type {
  PaperGridColumn,
  PaperProductColumn,
  PaperTemplate,
  PaperTemplateGrid,
  RecognizedEntry,
  RecognitionResult,
} from '../types'
import { getEntryCalculatedAmount } from './calculation'

export const DEFAULT_PAPER_TEMPLATE_ID = 'haowei-monthly-ledger'
const DEFAULT_TABLE_REGION = { x: 9.2, y: 5.6, width: 74, height: 94.1 }

const DEFAULT_PRODUCT_COLUMNS: PaperProductColumn[] = [
  { id: 'paper-1', label: '纸类1', unitPrice: null },
  { id: 'paper-2', label: '纸类2', unitPrice: null },
  { id: 'paper-3', label: '纸类3', unitPrice: null },
  { id: 'paper-4', label: '纸类4', unitPrice: null },
]

export function buildDefaultPaperGrid(
  productColumns: PaperProductColumn[],
  rowCount = 31,
  unloadingColumnLabel = '上下货',
  deductionLabel = '扣款',
): PaperTemplateGrid {
  const columns: PaperGridColumn[] = [
    { id: 'date', label: '日期', kind: 'date' },
    { id: 'attendance', label: '上班', kind: 'attendance' },
    ...productColumns.map((column) => ({
      id: column.id,
      label: column.label,
      kind: 'product' as const,
      productColumnId: column.id,
    })),
    { id: 'unloading', label: unloadingColumnLabel, kind: 'unloading' },
    { id: 'deduction', label: deductionLabel, kind: 'deduction' },
    { id: 'dailyTotal', label: '日合计', kind: 'dailyTotal' },
  ]

  return {
    rows: rowCount,
    columns,
    headerRows: 1,
    tableRegion: DEFAULT_TABLE_REGION,
    columnRatios: columns.map(() => 1),
    rowRatios: Array.from({ length: rowCount }, () => 1),
    anchors: [
      { id: 'top-left', label: '左上角', x: 0, y: 0 },
      { id: 'top-right', label: '右上角', x: 100, y: 0 },
      { id: 'bottom-left', label: '左下角', x: 0, y: 100 },
      { id: 'bottom-right', label: '右下角', x: 100, y: 100 },
    ],
  }
}

export const DEFAULT_PAPER_TEMPLATE: PaperTemplate = {
  id: DEFAULT_PAPER_TEMPLATE_ID,
  name: '浩伟食品月账本',
  rowCount: 31,
  productColumns: DEFAULT_PRODUCT_COLUMNS,
  unloadingColumnLabel: '上下货',
  deductionLabel: '扣款',
  grid: buildDefaultPaperGrid(DEFAULT_PRODUCT_COLUMNS),
  rules: {
    firstColumnIsAttendance: true,
    absentMarks: ['x', 'X', '×', '叉', '叉叉'],
    halfDayMarks: ['0.5', '.5', '半天', '上半天'],
    headerRowIsUnitPrice: true,
    unloadingAlreadyCalculated: true,
    deductionsAreSeparateAdjustments: true,
  },
}

function cleanText(text: string) {
  return text.trim().replace(/\s+/g, '').replace(/元/g, '')
}

function parseMoneyText(text: string) {
  const normalized = cleanText(text)
  const match = normalized.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const value = Number(match[0])
  return Number.isFinite(value) ? value : null
}

function isAttendanceEntry(entry: RecognizedEntry, template: PaperTemplate) {
  const text = cleanText(`${entry.rawText}${entry.normalizedText}`)
  const label = cleanText(`${entry.label}${entry.category}${entry.note ?? ''}`)
  const marks = [...template.rules.absentMarks, ...template.rules.halfDayMarks].map(cleanText)
  const looksLikeAttendanceColumn = entry.region.x < 25

  return (
    (template.rules.firstColumnIsAttendance &&
      (label.includes('上班') || label.includes('考勤') || label.includes('出勤'))) ||
    (looksLikeAttendanceColumn && marks.some((mark) => mark && text === mark))
  )
}

function isUnloadingEntry(entry: RecognizedEntry, template: PaperTemplate) {
  const label = cleanText(`${entry.label}${entry.category}${entry.note ?? ''}`)
  return Boolean(template.unloadingColumnLabel && label.includes(cleanText(template.unloadingColumnLabel)))
}

function isDeductionEntry(entry: RecognizedEntry, template: PaperTemplate) {
  const label = cleanText(`${entry.label}${entry.category}${entry.note ?? ''}`)
  const text = cleanText(`${entry.rawText}${entry.normalizedText}`)
  return Boolean(
    template.deductionLabel &&
      (label.includes(cleanText(template.deductionLabel)) || text.includes(cleanText(template.deductionLabel))),
  )
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function normalizePaperGrid(
  grid: Partial<PaperTemplateGrid> | undefined,
  productColumns: PaperProductColumn[],
  rowCount: number,
  unloadingColumnLabel: string,
  deductionLabel: string,
): PaperTemplateGrid {
  const fallback = buildDefaultPaperGrid(productColumns, rowCount, unloadingColumnLabel, deductionLabel)
  const columns = Array.isArray(grid?.columns) && grid.columns.length ? grid.columns : fallback.columns
  const rows =
    typeof grid?.rows === 'number' && Number.isFinite(grid.rows)
      ? grid.rows
      : rowCount

  return {
    rows,
    columns,
    headerRows:
      typeof grid?.headerRows === 'number' && Number.isFinite(grid.headerRows)
        ? grid.headerRows
        : fallback.headerRows,
    tableRegion:
      grid?.tableRegion &&
      Number.isFinite(grid.tableRegion.x) &&
      Number.isFinite(grid.tableRegion.y) &&
      Number.isFinite(grid.tableRegion.width) &&
      Number.isFinite(grid.tableRegion.height)
        ? grid.tableRegion
        : fallback.tableRegion,
    columnRatios:
      Array.isArray(grid?.columnRatios) && grid.columnRatios.length === columns.length
        ? grid.columnRatios
        : columns.map(() => 1),
    rowRatios:
      Array.isArray(grid?.rowRatios) && grid.rowRatios.length === rows
        ? grid.rowRatios
        : Array.from({ length: rows }, () => 1),
    anchors: Array.isArray(grid?.anchors) && grid.anchors.length ? grid.anchors : fallback.anchors,
  }
}

export function getTemplateGrid(template: PaperTemplate) {
  const expectedColumns = buildDefaultPaperGrid(
    template.productColumns,
    template.rowCount,
    template.unloadingColumnLabel,
    template.deductionLabel,
  ).columns
  const hasMatchingProductColumns = template.productColumns.every((column) =>
    template.grid.columns.some((gridColumn) => gridColumn.id === column.id),
  )
  const needsSync =
    template.grid.rows !== template.rowCount ||
    !hasMatchingProductColumns ||
    template.grid.columns.length !== expectedColumns.length

  return needsSync
    ? buildDefaultPaperGrid(
        template.productColumns,
        template.rowCount,
        template.unloadingColumnLabel,
        template.deductionLabel,
      )
    : template.grid
}

export function normalizePaperTemplates(templates: unknown): PaperTemplate[] {
  if (!Array.isArray(templates)) return [DEFAULT_PAPER_TEMPLATE]

  const normalized = templates
    .map((template): PaperTemplate | null => {
      if (!template || typeof template !== 'object') return null
      const value = template as Partial<PaperTemplate>
      const productColumns = Array.isArray(value.productColumns)
        ? value.productColumns
            .map((column, index): PaperProductColumn | null => {
              if (!column || typeof column !== 'object') return null
              const item = column as Partial<PaperProductColumn>
              return {
                id: item.id || `paper-${index + 1}`,
                label: item.label || `纸类${index + 1}`,
                unitPrice:
                  typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice)
                    ? item.unitPrice
                    : null,
              }
            })
            .filter((column): column is PaperProductColumn => Boolean(column))
        : DEFAULT_PAPER_TEMPLATE.productColumns

      return {
        ...DEFAULT_PAPER_TEMPLATE,
        ...value,
        id: value.id || DEFAULT_PAPER_TEMPLATE.id,
        name: value.name || DEFAULT_PAPER_TEMPLATE.name,
        rowCount:
          typeof value.rowCount === 'number' && Number.isFinite(value.rowCount)
            ? value.rowCount
            : DEFAULT_PAPER_TEMPLATE.rowCount,
        productColumns,
        grid: normalizePaperGrid(
          value.grid,
          productColumns,
          typeof value.rowCount === 'number' && Number.isFinite(value.rowCount)
            ? value.rowCount
            : DEFAULT_PAPER_TEMPLATE.rowCount,
          value.unloadingColumnLabel || DEFAULT_PAPER_TEMPLATE.unloadingColumnLabel,
          value.deductionLabel || DEFAULT_PAPER_TEMPLATE.deductionLabel,
        ),
        rules: {
          ...DEFAULT_PAPER_TEMPLATE.rules,
          ...(value.rules ?? {}),
          absentMarks: Array.isArray(value.rules?.absentMarks)
            ? value.rules.absentMarks
            : DEFAULT_PAPER_TEMPLATE.rules.absentMarks,
          halfDayMarks: Array.isArray(value.rules?.halfDayMarks)
            ? value.rules.halfDayMarks
            : DEFAULT_PAPER_TEMPLATE.rules.halfDayMarks,
        },
      }
    })
    .filter((template): template is PaperTemplate => Boolean(template))

  const singleTemplate = normalized[0] ?? DEFAULT_PAPER_TEMPLATE
  return [
    {
      ...singleTemplate,
      id: DEFAULT_PAPER_TEMPLATE_ID,
      name: DEFAULT_PAPER_TEMPLATE.name,
    },
  ]
}

export function getActivePaperTemplate(settings: {
  paperTemplates: PaperTemplate[]
  selectedPaperTemplateId: string
}) {
  return settings.paperTemplates[0] ?? DEFAULT_PAPER_TEMPLATE
}

export function productColumnsToText(columns: PaperProductColumn[]) {
  return columns
    .map((column) => `${column.label}${column.unitPrice === null ? '' : `=${column.unitPrice}`}`)
    .join('\n')
}

export function productColumnsFromText(text: string): PaperProductColumn[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [label, rawPrice] = line.split(/[=＝]/)
      const unitPrice = rawPrice === undefined || rawPrice.trim() === '' ? null : Number(rawPrice.trim())
      return {
        id: `paper-${index + 1}`,
        label: label.trim() || `纸类${index + 1}`,
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
      }
    })
}

export function buildPaperTemplateInstruction(template: PaperTemplate) {
  const configuredColumns = template.productColumns
    .map((column, index) => {
      const price = column.unitPrice === null ? '图片顶行读取' : String(column.unitPrice)
      return `${index + 1}. ${column.label}: 单价 ${price}`
    })
    .join('\n')

  return [
    `当前纸张模板：${template.name}`,
    '输入必须是一张完整单页账本照片：表格四角、表头单价行、日期列和 1日至31日都应在同一张图内。',
    '如果只看到局部页面、缺四角、缺表头或缺日期行，必须标记 cuttingRisk/pageIncomplete，不能静默输出局部总额。',
    `固定为 ${template.rowCount} 行月表，第一列是日期，第二列是上班状态。`,
    template.rules.firstColumnIsAttendance
      ? `第二列只表示出勤：${template.rules.absentMarks.join('/')} 是没上班；${template.rules.halfDayMarks.join('/')} 是上半天。这里的 0.5 不能当成整行金额倍率。`
      : '',
    template.rules.headerRowIsUnitPrice
      ? '第一行/顶行手写小数或数字是各纸类列单价，只作用于该列下方数量。'
      : '',
    configuredColumns ? `纸类列配置：\n${configuredColumns}` : '',
    template.rules.unloadingAlreadyCalculated
      ? `${template.unloadingColumnLabel} 列是用户已经算好的金额，保留为独立金额，去掉“元”等单位后按原值计入。`
      : '',
    template.rules.deductionsAreSeparateAdjustments
      ? `${template.deductionLabel} 单独列为调整项；写“扣款 10 元”或负数时按负金额计入，不要混到纸类数量里。`
      : '',
    '采用单页切割+纸张重构思路：先定位整张表格边界、日期行、表头单价行，再按格子归属读取内容；不要只按文字自然顺序相加。',
  ]
    .filter(Boolean)
    .join('\n')
}

export function applyPaperTemplateRules(
  result: RecognitionResult,
  template: PaperTemplate,
): RecognitionResult {
  const entries = result.entries.map((entry) => {
    if (isAttendanceEntry(entry, template)) {
      return {
        ...entry,
        amount: null,
        rawValue: null,
        multiplier: null,
        calculatedAmount: null,
        category: '出勤',
        note: entry.note || '出勤标记不参与金额计算。',
      }
    }

    if (template.rules.unloadingAlreadyCalculated && isUnloadingEntry(entry, template)) {
      const value = parseMoneyText(entry.normalizedText || entry.rawText)
      if (value === null) return entry
      return {
        ...entry,
        amount: value,
        rawValue: value,
        multiplier: 1,
        calculatedAmount: roundMoney(value),
        category: template.unloadingColumnLabel,
        note: entry.note || `${template.unloadingColumnLabel} 已按图片金额直接计入。`,
      }
    }

    if (template.rules.deductionsAreSeparateAdjustments && isDeductionEntry(entry, template)) {
      const value = parseMoneyText(entry.normalizedText || entry.rawText)
      if (value === null) return entry
      const signed = value > 0 ? -value : value
      return {
        ...entry,
        amount: signed,
        rawValue: signed,
        multiplier: 1,
        calculatedAmount: roundMoney(signed),
        category: template.deductionLabel,
        note: entry.note || `${template.deductionLabel} 已作为独立扣减项计入。`,
      }
    }

    return entry
  })

  const resultWithTemplateEntries: RecognitionResult = { ...result, entries }
  const computedTotal = roundMoney(
    entries.reduce((sum, entry) => {
      return sum + (getEntryCalculatedAmount(resultWithTemplateEntries, entry) ?? 0)
    }, 0),
  )

  const auditNote = `已应用纸张模板“${template.name}”：出勤列、顶行单价、${template.unloadingColumnLabel}、${template.deductionLabel} 按固定本子规则复核。`

  return {
    ...result,
    computedTotal,
    entries,
    auditNotes: result.auditNotes.includes(auditNote)
      ? result.auditNotes
      : [...result.auditNotes, auditNote],
  }
}
