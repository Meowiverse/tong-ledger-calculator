// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { ImageReview } from './components/ImageReview'
import { ReconstructedLedgerTable } from './components/ReconstructedLedgerTable'
import { SAMPLE_RECOGNITION } from './data/sampleRecognition'
import { normalizeResultCells } from './lib/ledgerCells'
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
    expect(within(main).getByRole('button', { name: '拍照或选择图片' })).toBeTruthy()
    expect(within(main).getByRole('button', { name: /开始计算/ })).toBeTruthy()
  })

  it('shows multiple sample image cases in lab mode', () => {
    window.history.replaceState({}, '', '/?lab=1')
    render(<App />)

    const sampleCases = screen.getByLabelText('多图片测试案例')
    expect(within(sampleCases).getByRole('button', { name: '原图样例' })).toBeTruthy()
    expect(within(sampleCases).getByRole('button', { name: '手机拍照样例' })).toBeTruthy()
    expect(within(sampleCases).getByRole('button', { name: '复扫样例' })).toBeTruthy()
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
})
