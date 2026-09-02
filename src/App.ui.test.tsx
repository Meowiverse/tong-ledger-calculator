// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { ImageReview } from './components/ImageReview'
import { PreflightPanel } from './components/PreflightPanel'
import { ReconstructedLedgerTable } from './components/ReconstructedLedgerTable'
import { SAMPLE_RECOGNITION } from './data/sampleRecognition'
import * as gridCutModule from './lib/gridCut'
import * as imageModule from './lib/image'
import { normalizeResultCells } from './lib/ledgerCells'
import * as ledgerCellsModule from './lib/ledgerCells'
import * as openaiModule from './lib/openai'
import { DEFAULT_PAPER_TEMPLATE } from './lib/paperTemplates'

function readStoredSettings() {
  const raw = window.localStorage.getItem('tong-ledger-settings-v1')
  if (!raw) throw new Error('settings were not saved')
  return JSON.parse(raw) as {
    paperTemplates: Array<{
      name: string
      rowCount: number
      productColumns: Array<{ label: string; unitPrice: number | null }>
      rules: {
        firstColumnIsAttendance: boolean
        unloadingAlreadyCalculated: boolean
        deductionsAreSeparateAdjustments: boolean
      }
    }>
  }
}

describe('App paper-template UI flow', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('lets the user configure the fixed notebook format and persists it', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '打开设置' }))
    await user.click(screen.getByText('纸张与接口设置'))

    expect(screen.getByText('固定账本格式')).toBeTruthy()
    expect(screen.queryByLabelText('纸张配置名')).toBeNull()
    expect(screen.queryByLabelText('日期行数')).toBeNull()
    expect(screen.getByLabelText('纸类列与单价')).toBeTruthy()

    const columnsInput = screen.getByLabelText('纸类列与单价')
    await user.clear(columnsInput)
    await user.click(columnsInput)
    await user.paste('大纸=2.5\n小纸=0.5\n散纸')

    await user.click(screen.getByRole('checkbox', { name: '上下货是已算好的金额' }))

    await waitFor(() => {
      const settings = readStoredSettings()
      expect(settings.paperTemplates).toHaveLength(1)
      expect(settings.paperTemplates[0].name).toBe('浩伟食品月账本')
      expect(settings.paperTemplates[0].rowCount).toBe(31)
      expect(settings.paperTemplates[0].productColumns).toEqual([
        { id: 'paper-1', label: '大纸', unitPrice: 2.5 },
        { id: 'paper-2', label: '小纸', unitPrice: 0.5 },
        { id: 'paper-3', label: '散纸', unitPrice: null },
      ])
      expect(settings.paperTemplates[0].rules.firstColumnIsAttendance).toBe(true)
      expect(settings.paperTemplates[0].rules.unloadingAlreadyCalculated).toBe(false)
      expect(settings.paperTemplates[0].rules.deductionsAreSeparateAdjustments).toBe(true)
    })
  })

  it('keeps the paper-template editor reachable without hiding capture controls', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '打开设置' }))
    await user.click(screen.getByText('纸张与接口设置'))

    const main = screen.getByRole('main')
    expect(within(main).getByText('固定账本格式')).toBeTruthy()
    expect(within(main).getByText(/拍完整单页/)).toBeTruthy()
    expect(within(main).getByRole('button', { name: '拍照或选择整页图片' })).toBeTruthy()
    expect(within(main).getByRole('button', { name: '开始计算' })).toBeTruthy()
  })

  it('shows multiple sample image cases in lab mode', () => {
    window.history.replaceState({}, '', '/?lab=1')
    render(<App />)

    const sampleCases = screen.getByLabelText('多图片测试案例')
    expect(within(sampleCases).getByRole('button', { name: '原图样例' })).toBeTruthy()
    expect(within(sampleCases).getByRole('button', { name: '手机拍照样例' })).toBeTruthy()
    expect(within(sampleCases).getByRole('button', { name: '复扫样例' })).toBeTruthy()
  })

  it('can build a local cutting preview from an uploaded image without model recognition', async () => {
    const user = userEvent.setup()
    render(<App />)

    const file = new File(['fake image'], 'ledger.jpg', { type: 'image/jpeg' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)

    const previewButton = screen.getByRole('button', { name: '单页切割预览' })
    await waitFor(() => expect(previewButton.hasAttribute('disabled')).toBe(false))
    await user.click(previewButton)

    expect(await screen.findByRole('region', { name: '重绘表格对照' })).toBeTruthy()
    expect(screen.getByText(/已从这一张图生成 31 行切割预览/)).toBeTruthy()
    expect(screen.getByText(/217 处待确认/)).toBeTruthy()
    expect(screen.getByLabelText('原图固定格子切割对照')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('系统不会把它当成可靠切割')
    expect(screen.getAllByRole('button', { name: /空白/ }).length).toBeGreaterThan(0)
  })

  it('keeps a manual override button after local preview holds model OCR', () => {
    const previewResult = normalizeResultCells(
      {
        ...SAMPLE_RECOGNITION,
        sourceType: '固定账本本地预览',
        entries: [],
        uncertainMarks: [],
      },
      DEFAULT_PAPER_TEMPLATE,
    )
    window.localStorage.setItem('tong-ledger-last-result-v5', JSON.stringify(previewResult))
    window.localStorage.setItem('tong-ledger-last-image-v3', '/samples/handwritten-ledger.png')
    window.localStorage.setItem(
      'tong-ledger-settings-v1',
      JSON.stringify({
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        apiMode: 'chatCompletions',
        model: 'gpt-4o-mini',
        qualityMode: 'high',
        priorityCropOcrEnabled: true,
        priorityCropOcrLimit: 8,
        selectedPromptId: 'ledger-fixed-grid',
        prompts: [
          {
            id: 'ledger-fixed-grid',
            name: '固定账本',
            emoji: '✨',
            description: 'test',
            prompt: 'test',
          },
        ],
        selectedPaperTemplateId: DEFAULT_PAPER_TEMPLATE.id,
        paperTemplates: [DEFAULT_PAPER_TEMPLATE],
      }),
    )

    render(<App />)
    expect(screen.getByRole('button', { name: '仍然送模型识别' })).toBeTruthy()
  })

  it('also keeps the manual override button in mockLocal mode without an API key', () => {
    const previewResult = normalizeResultCells(
      {
        ...SAMPLE_RECOGNITION,
        sourceType: '固定账本本地预览',
        entries: [],
        uncertainMarks: [],
      },
      DEFAULT_PAPER_TEMPLATE,
    )
    window.localStorage.setItem('tong-ledger-last-result-v5', JSON.stringify(previewResult))
    window.localStorage.setItem('tong-ledger-last-image-v3', '/samples/handwritten-ledger.png')
    window.localStorage.setItem(
      'tong-ledger-settings-v1',
      JSON.stringify({
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        apiMode: 'mockLocal',
        model: 'mock-local-max',
        qualityMode: 'max',
        priorityCropOcrEnabled: true,
        priorityCropOcrLimit: 2,
        selectedPromptId: 'ledger-fixed-grid',
        prompts: [
          {
            id: 'ledger-fixed-grid',
            name: '固定账本',
            emoji: '✨',
            description: 'test',
            prompt: 'test',
          },
        ],
        selectedPaperTemplateId: DEFAULT_PAPER_TEMPLATE.id,
        paperTemplates: [DEFAULT_PAPER_TEMPLATE],
      }),
    )

    render(<App />)
    expect(screen.getByRole('button', { name: '仍然送模型识别' })).toBeTruthy()
  })

  it('does not fall through into forced model recognition when one tap auto-routes to local review', async () => {
    const user = userEvent.setup()
    const recognizeSpy = vi.spyOn(openaiModule, 'recognizeLedgerImage')
    vi.spyOn(imageModule, 'preprocessImageForOcr').mockImplementation(async (dataUrl) => dataUrl)
    vi.spyOn(gridCutModule, 'detectLedgerGridFromImage').mockResolvedValue({
      method: 'cnn-hybrid',
      level: 'calibrate',
      label: '需先校准',
      score: 50,
      confidence: 0.5,
      tableRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
      fixedRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
      lines: { horizontal: [], vertical: [] },
      support: {
        expectedHorizontal: 33,
        expectedVertical: 10,
        detectedHorizontal: 17,
        detectedVertical: 3,
        rawHorizontalSpan: 41.94,
        rawVerticalSpan: 16.96,
        alignedHorizontalMatched: 15,
        alignedHorizontalSynthetic: 18,
        alignedVerticalMatched: 3,
        alignedVerticalSynthetic: 7,
        effectiveHorizontalCoverage: 0.68,
        effectiveVerticalCoverage: 0.72,
      },
      residuals: { x: 0.3, y: 0.3, max: 0.3 },
      fallback: { x: true, y: true },
      reasons: ['竖线证据不足，列边界回退模板', '横线证据不足，行边界回退模板'],
    })
    vi.spyOn(ledgerCellsModule, 'summarizeGridCutPreviewReadiness').mockReturnValue({
      reviewableCellCount: 217,
      lowCutCellCount: 0,
      lowCutRatio: 0,
      ocrCriticalCellCount: 186,
      ocrCriticalLowCutCellCount: 0,
      ocrCriticalLowCutRatio: 0,
      reviewCellCount: 217,
      calibrateCellCount: 0,
      meanCutConfidence: 0.67,
      modelGate: 'hold',
      reviewIntensity: 'manual-first',
      reason: '整页完整性模型判断这页更像缺页或裁切页（完整概率 42%），先别消耗 OCR token。',
      pageCompleteProbability: 0.42,
    })

    window.localStorage.setItem(
      'tong-ledger-settings-v1',
      JSON.stringify({
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        apiMode: 'mockLocal',
        model: 'mock-local-max',
        qualityMode: 'max',
        priorityCropOcrEnabled: true,
        priorityCropOcrLimit: 2,
        selectedPromptId: 'ledger-fixed-grid',
        prompts: [
          {
            id: 'ledger-fixed-grid',
            name: '固定账本',
            emoji: '✨',
            description: 'test',
            prompt: 'test',
          },
        ],
        selectedPaperTemplateId: DEFAULT_PAPER_TEMPLATE.id,
        paperTemplates: [DEFAULT_PAPER_TEMPLATE],
      }),
    )

    render(<App />)

    const file = new File(['fake image'], 'ledger.jpg', { type: 'image/jpeg' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '开始计算' }).hasAttribute('disabled')).toBe(false),
    )
    await user.click(screen.getByRole('button', { name: '开始计算' }))

    expect(await screen.findByText(/已自动切到本地复核/, undefined, { timeout: 3000 })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '仍然送模型识别' })).toBeNull()
    expect(recognizeSpy).not.toHaveBeenCalled()
  })

  it('holds before model recognition when local date preflight reports missing rows', async () => {
    const user = userEvent.setup()
    const recognizeSpy = vi.spyOn(openaiModule, 'recognizeLedgerImage')
    vi.spyOn(imageModule, 'preprocessImageForOcr').mockImplementation(async (dataUrl) => dataUrl)
    vi.spyOn(gridCutModule, 'detectLedgerGridFromImage').mockResolvedValue({
      method: 'cnn-hybrid',
      level: 'calibrate',
      label: '需先校准',
      score: 50,
      confidence: 0.5,
      tableRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
      fixedRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
      lines: { horizontal: [], vertical: [] },
      support: {
        expectedHorizontal: 33,
        expectedVertical: 10,
        detectedHorizontal: 16,
        detectedVertical: 2,
        rawHorizontalSpan: 39.22,
        rawVerticalSpan: 7.33,
        alignedHorizontalMatched: 15,
        alignedHorizontalSynthetic: 18,
        alignedVerticalMatched: 2,
        alignedVerticalSynthetic: 8,
        effectiveHorizontalCoverage: 0.68,
        effectiveVerticalCoverage: 0.72,
      },
      residuals: { x: 0.3, y: 0.3, max: 0.3 },
      fallback: { x: true, y: true },
      reasons: ['模板投影格网需日期预审兜底'],
    })
    vi.spyOn(ledgerCellsModule, 'summarizeGridCutPreviewReadiness').mockReturnValue({
      reviewableCellCount: 217,
      lowCutCellCount: 0,
      lowCutRatio: 0,
      ocrCriticalCellCount: 186,
      ocrCriticalLowCutCellCount: 0,
      ocrCriticalLowCutRatio: 0,
      reviewCellCount: 217,
      calibrateCellCount: 0,
      meanCutConfidence: 0.69,
      modelGate: 'send-with-review',
      reviewIntensity: 'normal',
      reason: '关键数字列大多已稳定，可先进 OCR，再重点抽查低置信格。',
      pageCompleteProbability: 0.47,
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'review',
          dateCount: 30,
          dateRange: '1-31',
          datesPresent: Array.from({ length: 30 }, (_, index) => (index < 8 ? index + 1 : index + 2)),
          datesMissing: [9],
          note: '日期预审接口未齐全。',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    window.localStorage.setItem(
      'tong-ledger-settings-v1',
      JSON.stringify({
        apiBaseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        apiMode: 'mockLocal',
        model: 'mock-local-max',
        qualityMode: 'max',
        localDatePreflightEnabled: true,
        localDatePreflightUrl: '/api/date-preflight',
        priorityCropOcrEnabled: true,
        priorityCropOcrLimit: 2,
        selectedPromptId: 'ledger-fixed-grid',
        prompts: [
          {
            id: 'ledger-fixed-grid',
            name: '固定账本',
            emoji: '✨',
            description: 'test',
            prompt: 'test',
          },
        ],
        selectedPaperTemplateId: DEFAULT_PAPER_TEMPLATE.id,
        paperTemplates: [DEFAULT_PAPER_TEMPLATE],
      }),
    )

    render(<App />)

    const file = new File(['fake image'], 'ledger.jpg', { type: 'image/jpeg' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '开始计算' }).hasAttribute('disabled')).toBe(false),
    )
    await user.click(screen.getByRole('button', { name: '开始计算' }))

    expect(await screen.findByText(/日期预审接口/, undefined, { timeout: 3000 })).toBeTruthy()
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/date-preflight',
      expect.objectContaining({ method: 'POST' }),
    )
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem('tong-ledger-last-result-v5') || 'null')
      expect(stored?.auditNotes?.join(' ')).toContain('日期预审接口')
    })
    expect(recognizeSpy).not.toHaveBeenCalled()
  })

  it('runs the low-cost self-check in mockLocal mode without asking for an API key', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '打开设置' }))
    await user.click(screen.getByText('纸张与接口设置'))
    await user.selectOptions(screen.getByLabelText('接口格式'), 'mockLocal')
    await user.click(screen.getByRole('button', { name: '开始自检' }))

    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('通过')
    expect(status.textContent).toContain('本地 mock 模式可直接演练整页识别、小图 OCR 和审核流程')
  })

  it('renders a reconstructed table that can select a source entry', async () => {
    const user = userEvent.setup()
    const onSelectEntry = vi.fn()

    render(
      <ReconstructedLedgerTable
        paperTemplate={DEFAULT_PAPER_TEMPLATE}
        result={normalizeResultCells(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE)}
        selectedEntryId=""
        onSelectEntry={onSelectEntry}
      />,
    )

    const reconstructed = screen.getByRole('region', { name: '重绘表格对照' })
    expect(within(reconstructed).getByText('重绘表格对照')).toBeTruthy()
    expect(within(reconstructed).getByText('4日')).toBeTruthy()
    expect(within(reconstructed).getByRole('button', { name: /584/ })).toBeTruthy()

    await user.click(within(reconstructed).getByRole('button', { name: /584/ }))
    expect(onSelectEntry).toHaveBeenCalledWith('d4-a')

    await user.click(within(reconstructed).getAllByRole('button', { name: /空白/ })[0])
    expect(onSelectEntry).toHaveBeenCalledWith(expect.stringMatching(/^r\d+-/))
  })

  it('keeps mobile review actions available from the selected cell inspector', async () => {
    const user = userEvent.setup()
    const onSelectEntry = vi.fn()
    const onUpdateCell = vi.fn()
    const result = normalizeResultCells(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE)

    render(
      <ReconstructedLedgerTable
        imageUrl="/samples/handwritten-ledger.png"
        paperTemplate={DEFAULT_PAPER_TEMPLATE}
        result={result}
        selectedEntryId="r1-paper-1"
        onSelectEntry={onSelectEntry}
        onUpdateCell={onUpdateCell}
      />,
    )

    const inspector = screen.getByRole('group', { name: '手机核查状态' })
    expect(within(inspector).getByText('当前合计')).toBeTruthy()
    expect(screen.getByLabelText('手机当前行核查入口')).toBeTruthy()
    expect(screen.getByLabelText('当前格子裁剪证据')).toBeTruthy()
    expect(screen.getByRole('button', { name: '上一格' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '下一格' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '下个风险' }))
    expect(onSelectEntry).toHaveBeenCalledWith(expect.stringMatching(/^r\d+-/))

    await user.click(screen.getByRole('button', { name: '确认正确' }))
    expect(onUpdateCell).toHaveBeenCalledWith('r1-paper-1', '', 'blank', expect.stringMatching(/^r\d+-/))
  })

  it('shows source-grid and cell-cut evidence in the image review', () => {
    render(
      <ImageReview
        imageUrl="/samples/handwritten-ledger.png"
        currentNumber={1}
        paperTemplate={DEFAULT_PAPER_TEMPLATE}
        result={normalizeResultCells(SAMPLE_RECOGNITION, DEFAULT_PAPER_TEMPLATE)}
        selectedEntryId="u-4a"
      />,
    )

    expect(screen.getByLabelText('原图固定格子切割对照')).toBeTruthy()
    expect(screen.getByLabelText('当前格子裁剪')).toBeTruthy()
    expect(screen.getByText('r4-paper-1')).toBeTruthy()
  })

  it('shows a preflight recommendation before model OCR', () => {
    render(
      <PreflightPanel
        gridCut={{
          method: 'cnn-hybrid',
          level: 'review',
          label: '建议抽查',
          score: 52,
          confidence: 0.52,
          tableRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
          fixedRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
          lines: { horizontal: [], vertical: [] },
          support: {
            expectedHorizontal: 33,
            expectedVertical: 10,
            detectedHorizontal: 12,
            detectedVertical: 2,
          },
          residuals: { x: 0.6, y: 0.8, max: 0.8 },
          fallback: { x: true, y: false },
          reasons: ['竖线证据不足，列边界回退模板', '模板约束补线 23 横 / 9 竖'],
        }}
        isRunning={false}
        readiness={{
          reviewableCellCount: 217,
          lowCutCellCount: 14,
          lowCutRatio: 0.065,
          ocrCriticalCellCount: 186,
          ocrCriticalLowCutCellCount: 12,
          ocrCriticalLowCutRatio: 0.065,
          reviewCellCount: 203,
          calibrateCellCount: 14,
          meanCutConfidence: 0.63,
          modelGate: 'send-with-review',
          reviewIntensity: 'normal',
          reason: '关键数字列大多已稳定，可先进 OCR，再重点抽查低置信格。',
        }}
        shouldHold={false}
      />,
    )

    expect(screen.getByRole('region', { name: '识别前本地预检' })).toBeTruthy()
    expect(screen.getByText('可识别，建议抽查')).toBeTruthy()
    expect(screen.getByText(/可先识别；重点抽查本地低置信格/)).toBeTruthy()
    expect(screen.getByText('14/217')).toBeTruthy()
  })

  it('shows a stronger preflight warning when OCR-critical cells still need heavy review', () => {
    render(
      <PreflightPanel
        gridCut={{
          method: 'cnn-hybrid',
          level: 'calibrate',
          label: '需先校准',
          score: 18,
          confidence: 0.18,
          tableRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
          fixedRegion: DEFAULT_PAPER_TEMPLATE.grid.tableRegion,
          lines: { horizontal: [], vertical: [] },
          support: {
            expectedHorizontal: 33,
            expectedVertical: 10,
            detectedHorizontal: 7,
            detectedVertical: 3,
          },
          residuals: { x: 0.99, y: 0.39, max: 0.99 },
          fallback: { x: true, y: true },
          reasons: ['模板投影格网仍贴合固定账本'],
        }}
        isRunning={false}
        readiness={{
          reviewableCellCount: 217,
          lowCutCellCount: 56,
          lowCutRatio: 0.258,
          ocrCriticalCellCount: 186,
          ocrCriticalLowCutCellCount: 48,
          ocrCriticalLowCutRatio: 0.258,
          reviewCellCount: 161,
          calibrateCellCount: 56,
          meanCutConfidence: 0.58,
          modelGate: 'send-with-review',
          reviewIntensity: 'strong',
          reason: '关键数字列大多已稳定，可先进 OCR，再重点抽查低置信格。',
        }}
        shouldHold={false}
      />,
    )

    expect(screen.getByText('可识别，需强抽查')).toBeTruthy()
    expect(screen.getByText(/优先核对切格低置信格和关键数字列/)).toBeTruthy()
    expect(screen.getByText('48/186')).toBeTruthy()
  })
})
