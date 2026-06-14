import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_SAMPLE_CASE,
  SAMPLE_CASES,
  findSampleCaseById,
  findSampleCaseByImageUrl,
} from '../data/sampleCases'
import {
  RECOGNITION_MODEL,
  RECOGNITION_QUALITY,
  STABILITY_RUNS,
} from '../recognitionConfig'
import { evaluateSampleCaseBenchmark } from '../lib/benchmark'
import { summarizeRecognition } from '../lib/calculation'
import { buildLedgerExportPayload } from '../lib/export'
import { fileToDataUrl, preprocessImageForOcr, urlToDataUrl } from '../lib/image'
import { normalizeResultCells, updateLedgerCell } from '../lib/ledgerCells'
import { recognizeLedgerImage } from '../lib/openai'
import {
  applyPaperTemplateRules,
  buildPaperTemplateInstruction,
  getActivePaperTemplate,
} from '../lib/paperTemplates'
import { activePrompt, createBlankPrompt } from '../lib/prompts'
import { correctRecognitionValue } from '../lib/reviewCorrection'
import {
  buildVerificationQueue,
  getNextVerificationItem,
  getVerificationProgress,
  type VerificationState,
} from '../lib/verification'
import {
  loadLastImage,
  loadLastResult,
  loadModelRuns,
  loadSettings,
  saveLastImage,
  saveLastResult,
  saveModelRun,
  saveSettings,
} from '../lib/storage'
import type {
  AppSettings,
  BenchmarkEvaluation,
  LedgerCellSemanticType,
  ModelRunRecord,
  OverlayMode,
  RecognitionResult,
  SmartPrompt,
  VerificationStatus,
} from '../types'

export function useLedgerApp() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [imageUrl, setImageUrl] = useState(() => loadLastImage())
  const [imageDataUrl, setImageDataUrl] = useState('')
  const [preprocessedImageUrl, setPreprocessedImageUrl] = useState('')
  const [preprocessedImageDataUrl, setPreprocessedImageDataUrl] = useState('')
  const [result, setResult] = useState<RecognitionResult | null>(() => loadLastResult())
  const [showSettings, setShowSettings] = useState(false)
  const [isRecognizing, setIsRecognizing] = useState(false)
  const [isBenchmarking, setIsBenchmarking] = useState(false)
  const [benchmarkProgress, setBenchmarkProgress] = useState('')
  const [error, setError] = useState('')
  const [modelRuns, setModelRuns] = useState<ModelRunRecord[]>(() => loadModelRuns())
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('low')
  const [selectedEntryId, setSelectedEntryId] = useState('')
  const [verificationState, setVerificationState] = useState<VerificationState>({})
  const [verificationQueue, setVerificationQueue] = useState(() => {
    const initialResult = loadLastResult()
    return initialResult ? buildVerificationQueue(initialResult) : []
  })
  const [reviewHistory, setReviewHistory] = useState<
    Array<{
      result: RecognitionResult
      selectedEntryId: string
      verificationQueue: typeof verificationQueue
      verificationState: VerificationState
    }>
  >([])
  const [reviewNotice, setReviewNotice] = useState('')

  const prompt = useMemo(() => activePrompt(settings), [settings])
  const activePaperTemplate = useMemo(() => getActivePaperTemplate(settings), [settings])
  const activeModel = settings.model.trim() || RECOGNITION_MODEL
  const stabilityBenchmarkRuns = useMemo(
    () =>
      Array.from({ length: STABILITY_RUNS }, (_, index) => ({
        label: `稳定性 ${index + 1}/${STABILITY_RUNS}`,
        model: activeModel,
        qualityMode: RECOGNITION_QUALITY,
      })),
    [activeModel],
  )
  const normalizeLedgerResult = (nextResult: RecognitionResult) =>
    normalizeResultCells(applyPaperTemplateRules(nextResult, activePaperTemplate), activePaperTemplate)
  const recognitionPrompt = useMemo(
    () => ({
      ...prompt,
      prompt: `${prompt.prompt}\n\n${buildPaperTemplateInstruction(activePaperTemplate)}`,
    }),
    [activePaperTemplate, prompt],
  )
  const summary = useMemo(() => (result ? summarizeRecognition(result) : null), [result])
  const activeSampleCase = useMemo(() => findSampleCaseByImageUrl(imageUrl), [imageUrl])
  const benchmark = useMemo(
    () => (result && activeSampleCase ? evaluateSampleCaseBenchmark(result, activeSampleCase) : null),
    [activeSampleCase, result],
  )
  const verificationProgress = useMemo(
    () => getVerificationProgress(verificationQueue, verificationState),
    [verificationQueue, verificationState],
  )
  const activeVerificationItem = useMemo(
    () => getNextVerificationItem(verificationQueue, verificationState),
    [verificationQueue, verificationState],
  )

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  function updateSettings(patch: Partial<AppSettings>) {
    setSettings((current) => ({
      ...current,
      ...patch,
      model: patch.model ?? current.model,
      qualityMode: RECOGNITION_QUALITY,
    }))
  }

  function updateCurrentPrompt(patch: Partial<SmartPrompt>) {
    setSettings((current) => ({
      ...current,
      prompts: current.prompts.map((item) =>
        item.id === current.selectedPromptId ? { ...item, ...patch } : item,
      ),
    }))
  }

  function updateActivePaperTemplate(
    patch:
      | Partial<typeof activePaperTemplate>
      | ((template: typeof activePaperTemplate) => typeof activePaperTemplate),
  ) {
    setSettings((current) => {
      const currentTemplate = getActivePaperTemplate(current)
      const nextTemplate =
        typeof patch === 'function' ? patch(currentTemplate) : { ...currentTemplate, ...patch }

      return {
        ...current,
        selectedPaperTemplateId: nextTemplate.id,
        paperTemplates: [nextTemplate],
      }
    })
  }

  function addPrompt() {
    const nextPrompt = createBlankPrompt()
    setSettings((current) => ({
      ...current,
      selectedPromptId: nextPrompt.id,
      prompts: [...current.prompts, nextPrompt],
    }))
  }

  function deleteCurrentPrompt() {
    setSettings((current) => {
      if (current.prompts.length <= 1) return current
      const prompts = current.prompts.filter((item) => item.id !== current.selectedPromptId)
      return {
        ...current,
        prompts,
        selectedPromptId: prompts[0].id,
      }
    })
  }

  async function handleFile(file: File) {
    setError('')
    const dataUrl = await fileToDataUrl(file)
    setImageDataUrl(dataUrl)
    setImageUrl(dataUrl)
    try {
      const nextPreprocessed = await preprocessImageForOcr(dataUrl)
      setPreprocessedImageDataUrl(nextPreprocessed)
      setPreprocessedImageUrl(nextPreprocessed)
    } catch {
      setPreprocessedImageDataUrl(dataUrl)
      setPreprocessedImageUrl(dataUrl)
      setError('图片预处理失败，已使用原图继续；仍可先做单页切割预览。')
    }
    setResult(null)
    setOverlayMode('low')
    setSelectedEntryId('')
    setVerificationState({})
    setVerificationQueue([])
    setReviewHistory([])
    setReviewNotice('')
    saveLastImage(dataUrl)
  }

  async function loadSample(sampleCaseId = DEFAULT_SAMPLE_CASE.id) {
    const sampleCase = findSampleCaseById(sampleCaseId)
    setError('')
    const dataUrl = await urlToDataUrl(sampleCase.imageUrl)
    const nextPreprocessed = await preprocessImageForOcr(dataUrl)
    const normalizedSample = normalizeLedgerResult(sampleCase.expectedResult)
    setImageDataUrl(dataUrl)
    setImageUrl(sampleCase.imageUrl)
    setPreprocessedImageDataUrl(nextPreprocessed)
    setPreprocessedImageUrl(nextPreprocessed)
    setResult(normalizedSample)
    setOverlayMode('low')
    setSelectedEntryId(normalizedSample.uncertainMarks[0]?.id ?? normalizedSample.entries[0]?.id ?? '')
    setVerificationState({})
    setVerificationQueue(buildVerificationQueue(normalizedSample))
    setReviewHistory([])
    setReviewNotice('')
  }

  function previewLocalCutting() {
    if (!imageUrl) {
      setError('先拍完整单页账本或选择整页图片，再查看切割预览。')
      return
    }

    const previewResult = normalizeLedgerResult({
      title: '本地切割预览',
      sourceType: '固定账本本地预览',
      summary: '未调用模型识别；当前按单张完整账本页生成 31 行固定格、裁剪证据和原图定位。',
      currency: 'CNY',
      overallConfidence: 0.35,
      computedTotal: null,
      calculationFormula: '本地预览不计算金额；补录或模型识别后再按格子规则复算。',
      columnRules: [],
      entries: [],
      uncertainMarks: [],
      extractedText: ['单页切割预览：已从这一张图片生成完整固定格；尚未识别手写数字。'],
      auditNotes: [
        '这是纯本地单页模板切割预览，用于检查整页格子是否对准原图。',
        '如果照片不是完整账本页，不能静默按局部结果通过。',
        '所有可计算格会进入核查队列；确认或补录后才会计入金额。',
      ],
    })
    const firstReviewableCell = previewResult.cells?.find(
      (cell) => cell.columnKind !== 'date' && cell.columnKind !== 'dailyTotal',
    )

    setError('')
    setResult(previewResult)
    setOverlayMode('low')
    setSelectedEntryId(firstReviewableCell?.id ?? '')
    setVerificationState({})
    setVerificationQueue(buildVerificationQueue(previewResult))
    setReviewHistory([])
    setReviewNotice('已从这一张图生成 31 行切割预览；未调用模型，图片没有离开浏览器。')
    if (!activeSampleCase) saveLastResult(previewResult)
  }

  function recordModelRun(record: Omit<ModelRunRecord, 'createdAt' | 'id'>) {
    const nextRecords = saveModelRun({
      ...record,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    })
    setModelRuns(nextRecords)
    return nextRecords
  }

  function applyResult(nextResult: RecognitionResult, nextImageUrl = imageUrl) {
    const normalizedResult = normalizeLedgerResult(nextResult)
    setResult(normalizedResult)
    setOverlayMode('low')
    setSelectedEntryId(
      normalizedResult.uncertainMarks[0]?.id ?? normalizedResult.entries[0]?.id ?? '',
    )
    setVerificationState({})
    setVerificationQueue(buildVerificationQueue(normalizedResult))
    setReviewHistory([])
    setReviewNotice('')
    if (!findSampleCaseByImageUrl(nextImageUrl)) {
      saveLastImage(nextImageUrl)
      saveLastResult(normalizedResult)
    }
  }

  async function runRecognition() {
    if (!imageDataUrl) {
      setError('先拍照或加载测试案例，再开始计算。')
      return
    }

    if (!settings.apiKey.trim()) {
      setShowSettings(true)
      setError('请先在设置中填写 API Key。密钥只保存在当前设备。')
      return
    }

    setIsRecognizing(true)
    setError('')
    const startedAt = Date.now()
    try {
      const nextResult = await recognizeLedgerImage({
        apiBaseUrl: settings.apiBaseUrl,
        apiKey: settings.apiKey.trim(),
        apiMode: settings.apiMode,
        imageDataUrl,
        preprocessedImageDataUrl,
        model: activeModel,
        prompt: recognitionPrompt,
        qualityMode: RECOGNITION_QUALITY,
      })
      applyResult(nextResult)
      if (activeSampleCase) {
        const nextBenchmark = evaluateSampleCaseBenchmark(nextResult, activeSampleCase)
        recordModelRun({
          apiMode: settings.apiMode,
          benchmark: nextBenchmark,
          durationMs: Date.now() - startedAt,
          model: activeModel,
          qualityMode: RECOGNITION_QUALITY,
          status: 'success',
        })
      }
    } catch (recognitionError) {
      const message = recognitionError instanceof Error ? recognitionError.message : '识别失败。'
      setError(message)
      if (activeSampleCase) {
        recordModelRun({
          apiMode: settings.apiMode,
          durationMs: Date.now() - startedAt,
          error: message,
          model: activeModel,
          qualityMode: RECOGNITION_QUALITY,
          status: 'error',
        })
      }
    } finally {
      setIsRecognizing(false)
    }
  }

  async function runModelBenchmarkSuite() {
    if (!settings.apiKey.trim()) {
      setError('先填写 API Key，再运行模型实验。')
      return
    }

    setError('')
    setIsBenchmarking(true)
    setIsRecognizing(true)

    const dataUrl =
      activeSampleCase && imageDataUrl ? imageDataUrl : await urlToDataUrl(DEFAULT_SAMPLE_CASE.imageUrl)
    const nextPreprocessed = await preprocessImageForOcr(dataUrl)
    setImageDataUrl(dataUrl)
    setPreprocessedImageDataUrl(nextPreprocessed)
    setPreprocessedImageUrl(nextPreprocessed)
    setImageUrl(DEFAULT_SAMPLE_CASE.imageUrl)

    let bestResult: RecognitionResult | null = null
    let bestBenchmark: BenchmarkEvaluation | null = null

    try {
      for (const candidate of stabilityBenchmarkRuns) {
        setBenchmarkProgress(candidate.label)
        const startedAt = Date.now()

        try {
          const candidateResult = await recognizeLedgerImage({
            apiBaseUrl: settings.apiBaseUrl,
            apiKey: settings.apiKey.trim(),
            apiMode: settings.apiMode,
            imageDataUrl: dataUrl,
            preprocessedImageDataUrl: nextPreprocessed,
            model: candidate.model,
            prompt: recognitionPrompt,
            qualityMode: candidate.qualityMode,
          })
          const candidateBenchmark = evaluateSampleCaseBenchmark(candidateResult, DEFAULT_SAMPLE_CASE)
          recordModelRun({
            apiMode: settings.apiMode,
            benchmark: candidateBenchmark,
            durationMs: Date.now() - startedAt,
            model: candidate.model,
            qualityMode: candidate.qualityMode,
            status: 'success',
          })

          const isBetter =
            !bestBenchmark ||
            Math.abs(candidateBenchmark.totalError) < Math.abs(bestBenchmark.totalError) ||
            (Math.abs(candidateBenchmark.totalError) === Math.abs(bestBenchmark.totalError) &&
              candidateBenchmark.matchedEntries > bestBenchmark.matchedEntries)

          if (isBetter) {
            bestBenchmark = candidateBenchmark
            bestResult = candidateResult
            applyResult(candidateResult, DEFAULT_SAMPLE_CASE.imageUrl)
          }
        } catch (suiteError) {
          recordModelRun({
            apiMode: settings.apiMode,
            durationMs: Date.now() - startedAt,
            error: suiteError instanceof Error ? suiteError.message : '模型实验失败。',
            model: candidate.model,
            qualityMode: candidate.qualityMode,
            status: 'error',
          })
        }
      }

      if (!bestResult) setError('模型实验没有得到可用结果。')
    } finally {
      setBenchmarkProgress('')
      setIsBenchmarking(false)
      setIsRecognizing(false)
    }
  }

  function downloadJson() {
    if (!result) return
    const blob = new Blob([JSON.stringify(buildLedgerExportPayload(result, activePaperTemplate), null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'tong-ledger-result.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  function saveReviewSnapshot() {
    if (!result) return
    setReviewHistory((current) => [
      ...current,
      { result, selectedEntryId, verificationQueue, verificationState },
    ])
  }

  function advanceReview(itemId: string, status: VerificationStatus, notice: string) {
    saveReviewSnapshot()
    const nextState = { ...verificationState, [itemId]: status }
    const nextItem = getNextVerificationItem(verificationQueue, nextState)
    setVerificationState(nextState)
    if (nextItem?.targetId) setSelectedEntryId(nextItem.targetId)
    setReviewNotice(notice)
  }

  function confirmVerification(itemId: string) {
    advanceReview(itemId, 'confirmed', '已确认，正在显示下一处。')
  }

  function skipVerification(itemId: string) {
    const deferredItem = verificationQueue.find((item) => item.id === itemId)
    if (!deferredItem) return
    saveReviewSnapshot()
    const reordered = [
      ...verificationQueue.filter((item) => item.id !== itemId),
      deferredItem,
    ]
    const nextItem = getNextVerificationItem(reordered, verificationState)
    setVerificationQueue(reordered)
    if (nextItem?.targetId) setSelectedEntryId(nextItem.targetId)
    setReviewNotice('已移到队列最后，完成其他位置后会再次出现。')
  }

  function correctVerificationValue(itemId: string, targetId: string, value: string) {
    if (!result) return
    const normalized = value.trim()
    const numericValue = Number(normalized)
    if (!normalized || !Number.isFinite(numericValue)) return

    saveReviewSnapshot()
    const previousTotal = summarizeRecognition(result).total
    const targetCell = result.cells?.find((cell) => cell.id === targetId)
    const nextRawResult = targetCell
      ? updateLedgerCell(result, activePaperTemplate, targetCell.id, {
          rawText: normalized,
          normalizedText: normalized,
          semanticType:
            targetCell.semanticType === 'blank' || targetCell.semanticType === 'uncertain'
              ? 'quantity'
              : targetCell.semanticType,
          note: '用户已从复核卡片修正该格。',
        })
      : correctRecognitionValue(result, targetId, normalized)
    const nextResult = normalizeLedgerResult(nextRawResult)
    const nextState = { ...verificationState, [itemId]: 'confirmed' as const }
    const nextItem = getNextVerificationItem(verificationQueue, nextState)
    const nextTotal = summarizeRecognition(nextResult).total

    setResult(nextResult)
    setVerificationState(nextState)
    if (nextItem?.targetId) setSelectedEntryId(nextItem.targetId)
    setReviewNotice(
      previousTotal === nextTotal
        ? `已改为 ${normalized}，合计没有变化。`
        : `已改为 ${normalized}，合计由 ${previousTotal.toFixed(2)} 变为 ${nextTotal.toFixed(2)}。`,
    )
    if (!activeSampleCase) saveLastResult(nextResult)
  }

  function updateCellValue(
    cellId: string,
    value: string,
    semanticType: LedgerCellSemanticType,
    nextSelectedCellId?: string,
  ) {
    if (!result) return
    const normalized = value.trim()
    if (semanticType !== 'blank' && semanticType !== 'attendance' && !normalized) return

    saveReviewSnapshot()
    const previousTotal = summarizeRecognition(result).total
    const nextResult = normalizeLedgerResult(
      updateLedgerCell(result, activePaperTemplate, cellId, {
        rawText: normalized,
        normalizedText: normalized,
        semanticType,
        note: semanticType === 'blank' ? '用户确认该格为空白。' : '用户已按格子对照修正。',
      }),
    )
    const nextQueue = buildVerificationQueue(nextResult)
    const nextTotal = summarizeRecognition(nextResult).total

    setResult(nextResult)
    setVerificationQueue(nextQueue)
    setSelectedEntryId(nextSelectedCellId || cellId)
    setReviewNotice(
      previousTotal === nextTotal
        ? '格子已更新，合计没有变化。'
        : `格子已更新，合计由 ${previousTotal.toFixed(2)} 变为 ${nextTotal.toFixed(2)}。`,
    )
    if (!activeSampleCase) saveLastResult(nextResult)
  }

  function undoLastReview() {
    const previous = reviewHistory.at(-1)
    if (!previous) return
    setResult(previous.result)
    setVerificationQueue(previous.verificationQueue)
    setVerificationState(previous.verificationState)
    setSelectedEntryId(previous.selectedEntryId)
    setReviewHistory((current) => current.slice(0, -1))
    setReviewNotice('已撤销上一步。')
  }

  return {
    activeVerificationItem,
    addPrompt,
    activePaperTemplate,
    benchmark,
    deleteCurrentPrompt,
    downloadJson,
    error,
    handleFile,
    imageUrl,
    isBenchmarking,
    isRecognizing,
    loadSample,
    benchmarkProgress,
    canUndoReview: reviewHistory.length > 0,
    confirmVerification,
    correctVerificationValue,
    modelRuns,
    overlayMode,
    prompt,
    previewLocalCutting,
    reviewImageUrl: preprocessedImageUrl || imageUrl,
    result,
    reviewNotice,
    runModelBenchmarkSuite,
    sampleCases: SAMPLE_CASES,
    runRecognition,
    selectedEntryId,
    setOverlayMode,
    setSelectedEntryId,
    skipVerification,
    setShowSettings,
    settings,
    showSettings,
    summary,
    updateCurrentPrompt,
    updateActivePaperTemplate,
    updateCellValue,
    updateSettings,
    undoLastReview,
    verificationProgress,
    verificationQueue,
    verificationState,
  }
}
