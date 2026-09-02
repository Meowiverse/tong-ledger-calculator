import { useEffect, useMemo, useRef, useState } from 'react'
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
import { buildCropOcrPlan } from '../lib/cropOcrPlan'
import { applyCropOcrReview } from '../lib/cropOcrReview'
import { buildLedgerExportPayload } from '../lib/export'
import { detectLedgerGridFromImage, shouldHoldForManualGridReview } from '../lib/gridCut'
import { fileToDataUrl, preprocessImageForOcr, urlToDataUrl } from '../lib/image'
import {
  normalizeResultCells,
  summarizeGridCutPreviewReadiness,
  updateLedgerCell,
  type GridCutPreviewReadiness,
} from '../lib/ledgerCells'
import {
  runLocalDatePreflight,
  shouldHoldForLocalDatePreflight,
  type LocalDatePreflightReport,
} from '../lib/localDatePreflight'
import { recognizeLedgerImage, reviewPriorityCellCrops, runApiSelfCheck } from '../lib/openai'
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
import { captureCellTrainingSample } from '../lib/trainingSamples'
import type {
  AppSettings,
  ApiSelfCheckReport,
  BenchmarkEvaluation,
  LedgerCellSemanticType,
  ModelRunRecord,
  OverlayMode,
  RecognitionResult,
  SmartPrompt,
  VerificationStatus,
  GridCutEvidence,
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
  const [recognitionElapsedSeconds, setRecognitionElapsedSeconds] = useState(0)
  const [recognitionStage, setRecognitionStage] = useState('')
  const [modelRuns, setModelRuns] = useState<ModelRunRecord[]>(() => loadModelRuns())
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('low')
  const [selectedEntryId, setSelectedEntryId] = useState('')
  const [preflightGridCut, setPreflightGridCut] = useState<GridCutEvidence | null>(null)
  const [preflightReadiness, setPreflightReadiness] = useState<GridCutPreviewReadiness | null>(null)
  const [isPreflighting, setIsPreflighting] = useState(false)
  const [verificationState, setVerificationState] = useState<VerificationState>({})
  const [apiSelfCheck, setApiSelfCheck] = useState<ApiSelfCheckReport | null>(null)
  const [isCheckingApi, setIsCheckingApi] = useState(false)
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
  const [isPreviewOverrideLocked, setIsPreviewOverrideLocked] = useState(false)
  const previewOverrideTimerRef = useRef<number | null>(null)
  const previewOverrideLockedRef = useRef(false)
  const preflightGridCutRef = useRef<GridCutEvidence | null>(null)
  const preflightReadinessRef = useRef<GridCutPreviewReadiness | null>(null)
  const imageDataUrlRef = useRef(imageDataUrl)
  const preprocessedImageDataUrlRef = useRef(preprocessedImageDataUrl)
  const imageSessionRef = useRef(0)
  const preflightTaskRef = useRef<Promise<{
    gridCut: GridCutEvidence | null
    readiness: GridCutPreviewReadiness | null
  }> | null>(null)

  const prompt = useMemo(() => activePrompt(settings), [settings])
  const activePaperTemplate = useMemo(() => getActivePaperTemplate(settings), [settings])
  const activeModel = settings.model.trim() || RECOGNITION_MODEL
  const activeQualityMode = settings.qualityMode || RECOGNITION_QUALITY
  const canRunWithoutApiKey = settings.apiMode === 'mockLocal'
  const canContinueFromPreview = canRunWithoutApiKey || Boolean(settings.apiKey.trim())
  const benchmarkQualityMode = activeQualityMode === 'max' ? 'high' : activeQualityMode
  const priorityCropOcrLimit = Math.min(24, Math.max(0, Math.round(settings.priorityCropOcrLimit || 0)))
  const stabilityBenchmarkRuns = useMemo(
    () =>
      Array.from({ length: STABILITY_RUNS }, (_, index) => ({
        label: `稳定性 ${index + 1}/${STABILITY_RUNS}`,
        model: activeModel,
        qualityMode: benchmarkQualityMode,
      })),
    [activeModel, benchmarkQualityMode],
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
  const cropOcrPlan = useMemo(
    () => (result ? buildCropOcrPlan(result, activePaperTemplate) : null),
    [activePaperTemplate, result],
  )
  const verificationProgress = useMemo(
    () => getVerificationProgress(verificationQueue, verificationState),
    [verificationQueue, verificationState],
  )
  const activeVerificationItem = useMemo(
    () => getNextVerificationItem(verificationQueue, verificationState),
    [verificationQueue, verificationState],
  )

  function preferredSelectionId(nextResult: RecognitionResult, queue = buildVerificationQueue(nextResult)) {
    return (
      queue[0]?.targetId ??
      nextResult.uncertainMarks[0]?.id ??
      nextResult.entries[0]?.id ??
      nextResult.cells?.find((cell) => cell.columnKind !== 'date' && cell.columnKind !== 'dailyTotal')?.id ??
      ''
    )
  }

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    preflightGridCutRef.current = preflightGridCut
  }, [preflightGridCut])

  useEffect(() => {
    preflightReadinessRef.current = preflightReadiness
  }, [preflightReadiness])

  useEffect(() => {
    imageDataUrlRef.current = imageDataUrl
  }, [imageDataUrl])

  useEffect(() => {
    preprocessedImageDataUrlRef.current = preprocessedImageDataUrl
  }, [preprocessedImageDataUrl])

  useEffect(
    () => () => {
      if (previewOverrideTimerRef.current !== null) window.clearTimeout(previewOverrideTimerRef.current)
      previewOverrideLockedRef.current = false
    },
    [],
  )

  useEffect(() => {
    if (!isRecognizing) {
      return undefined
    }

    const startedAt = Date.now() - recognitionElapsedSeconds * 1000
    const timer = window.setInterval(() => {
      setRecognitionElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isRecognizing, recognitionElapsedSeconds])

  function armPreviewOverrideLock() {
    if (previewOverrideTimerRef.current !== null) window.clearTimeout(previewOverrideTimerRef.current)
    previewOverrideLockedRef.current = true
    setIsPreviewOverrideLocked(true)
    previewOverrideTimerRef.current = window.setTimeout(() => {
      previewOverrideLockedRef.current = false
      setIsPreviewOverrideLocked(false)
      previewOverrideTimerRef.current = null
    }, 900)
  }

  function updateSettings(patch: Partial<AppSettings>) {
    if (
      'apiBaseUrl' in patch ||
      'apiKey' in patch ||
      'apiMode' in patch ||
      'model' in patch
    ) {
      setApiSelfCheck(null)
    }
    setSettings((current) => ({
      ...current,
      ...patch,
      model: patch.model ?? current.model,
      qualityMode:
        patch.qualityMode === 'fast' || patch.qualityMode === 'high' || patch.qualityMode === 'max'
          ? patch.qualityMode
          : current.qualityMode,
      priorityCropOcrLimit:
        typeof patch.priorityCropOcrLimit === 'number' && Number.isFinite(patch.priorityCropOcrLimit)
          ? Math.min(24, Math.max(0, Math.round(patch.priorityCropOcrLimit)))
          : current.priorityCropOcrLimit,
      localDatePreflightUrl:
        typeof patch.localDatePreflightUrl === 'string'
          ? patch.localDatePreflightUrl
          : current.localDatePreflightUrl,
    }))
  }

  function clearPreflightTask(
    task?: Promise<{
      gridCut: GridCutEvidence | null
      readiness: GridCutPreviewReadiness | null
    }> | null,
  ) {
    if (!task || preflightTaskRef.current === task) preflightTaskRef.current = null
  }

  function startPreflight(sourceDataUrl: string, sessionId = imageSessionRef.current) {
    setIsPreflighting(true)
    const task = detectGridCutSafely(sourceDataUrl)
      .then((gridCut) => {
        const readiness = gridCut ? summarizeGridCutPreviewReadiness(gridCut, activePaperTemplate) : null
        if (sessionId === imageSessionRef.current) {
          setPreflightGridCut(gridCut)
          preflightGridCutRef.current = gridCut
          setPreflightReadiness(readiness)
          preflightReadinessRef.current = readiness
        }
        return { gridCut, readiness }
      })
      .finally(() => {
        clearPreflightTask(task)
        if (sessionId === imageSessionRef.current) setIsPreflighting(false)
      })
    preflightTaskRef.current = task
    return task
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
    imageSessionRef.current += 1
    const sessionId = imageSessionRef.current
    setError('')
    setResult(null)
    setOverlayMode('low')
    setSelectedEntryId('')
    setVerificationState({})
    setVerificationQueue([])
    setReviewHistory([])
    setReviewNotice('')
    setPreflightGridCut(null)
    preflightGridCutRef.current = null
    setPreflightReadiness(null)
    preflightReadinessRef.current = null
    setImageDataUrl('')
    setImageUrl('')
    setPreprocessedImageDataUrl('')
    setPreprocessedImageUrl('')
    clearPreflightTask()

    setIsPreflighting(true)
    const task = (async () => {
      const dataUrl = await fileToDataUrl(file)
      if (sessionId === imageSessionRef.current) {
        setImageDataUrl(dataUrl)
        setImageUrl(dataUrl)
        saveLastImage(dataUrl)
      }
      let sourceForCut = dataUrl
      try {
        const nextPreprocessed = await preprocessImageForOcr(dataUrl)
        sourceForCut = nextPreprocessed
        if (sessionId === imageSessionRef.current) {
          setPreprocessedImageDataUrl(nextPreprocessed)
          setPreprocessedImageUrl(nextPreprocessed)
        }
      } catch {
        if (sessionId === imageSessionRef.current) {
          setPreprocessedImageDataUrl(dataUrl)
          setPreprocessedImageUrl(dataUrl)
          setError('图片预处理失败，已使用原图继续；仍可先做单页切割预览。')
        }
      }

      const gridCut = await detectGridCutSafely(sourceForCut)
      const readiness = gridCut ? summarizeGridCutPreviewReadiness(gridCut, activePaperTemplate) : null
      if (sessionId === imageSessionRef.current) {
        setPreflightGridCut(gridCut)
        preflightGridCutRef.current = gridCut
        setPreflightReadiness(readiness)
        preflightReadinessRef.current = readiness
      }
      return { gridCut, readiness }
    })().finally(() => {
      clearPreflightTask(task)
      if (sessionId === imageSessionRef.current) setIsPreflighting(false)
    })
    preflightTaskRef.current = task
  }

  async function loadSample(sampleCaseId = DEFAULT_SAMPLE_CASE.id) {
    imageSessionRef.current += 1
    const sampleCase = findSampleCaseById(sampleCaseId)
    setError('')
    const dataUrl = await urlToDataUrl(sampleCase.imageUrl)
    const nextPreprocessed = await preprocessImageForOcr(dataUrl)
    const sampleGridCut = await detectLedgerGridFromImage(nextPreprocessed || dataUrl, activePaperTemplate).catch(
      () => null,
    )
    const normalizedSample = normalizeLedgerResult({
      ...sampleCase.expectedResult,
      gridCut: sampleGridCut ?? undefined,
    })
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
    setPreflightGridCut(sampleGridCut)
    preflightGridCutRef.current = sampleGridCut
    const sampleReadiness = sampleGridCut ? summarizeGridCutPreviewReadiness(sampleGridCut, activePaperTemplate) : null
    setPreflightReadiness(sampleReadiness)
    preflightReadinessRef.current = sampleReadiness
    clearPreflightTask()
    setIsPreflighting(false)
  }

  function commitLocalCuttingPreview(gridCut: GridCutEvidence | null, extraAuditNotes: string[] = []) {
    const previewResult = normalizeLedgerResult({
      title: '本地切割预览',
      sourceType: '固定账本本地预览',
      summary: gridCut
        ? `未调用模型识别；本地线条切格 ${gridCut.score} 分，${gridCut.label}。`
        : '未调用模型识别；当前按固定模板生成 31 行格子、裁剪证据和原图定位。',
      currency: 'CNY',
      overallConfidence: gridCut?.confidence ?? 0.35,
      computedTotal: null,
      calculationFormula: '本地预览不计算金额；补录或模型识别后再按格子规则复算。',
      columnRules: [],
      entries: [],
      uncertainMarks: [],
      extractedText: ['单页切割预览：已从这一张图片生成完整固定格；尚未识别手写数字。'],
      auditNotes: [
        gridCut
          ? `这是纯本地线条投影切格预览：${gridCut.reasons.join('；')}。`
          : '这是纯本地固定模板切割预览，用于检查整页格子是否对准原图。',
        '如果照片不是完整账本页，不能静默按局部结果通过。',
        '所有可计算格会进入核查队列；确认或补录后才会计入金额。',
        ...extraAuditNotes,
      ],
      gridCut: gridCut ?? undefined,
    })
    const firstReviewableCell = previewResult.cells?.find(
      (cell) => cell.columnKind !== 'date' && cell.columnKind !== 'dailyTotal',
    )
    const nextQueue = buildVerificationQueue(previewResult)

    setError('')
    setResult(previewResult)
    setOverlayMode('low')
    setSelectedEntryId(nextQueue[0]?.targetId ?? firstReviewableCell?.id ?? '')
    setVerificationState({})
    setVerificationQueue(nextQueue)
    setReviewHistory([])
    setReviewNotice(
      gridCut
        ? `已从这一张图生成 31 行切割预览；本地线条切格 ${gridCut.score} 分，${gridCut.label}。`
        : '已从这一张图生成 31 行切割预览；正在尝试本地线条检测，未调用模型。',
    )
    if (!activeSampleCase) saveLastResult(previewResult)
    setPreflightGridCut(gridCut)
    preflightGridCutRef.current = gridCut
    const nextReadiness = gridCut ? summarizeGridCutPreviewReadiness(gridCut, activePaperTemplate) : null
    setPreflightReadiness(nextReadiness)
    preflightReadinessRef.current = nextReadiness
    clearPreflightTask()
    setIsPreflighting(false)
  }

  function previewLocalCutting() {
    if (!imageUrl) {
      setError('先拍完整单页账本或选择整页图片，再查看切割预览。')
      return
    }

    commitLocalCuttingPreview(null)
    detectLedgerGridFromImage(preprocessedImageDataUrl || imageDataUrl || imageUrl, activePaperTemplate)
      .then((gridCut) => commitLocalCuttingPreview(gridCut))
      .catch(() => {
        setReviewNotice('已从这一张图生成 31 行切割预览；本地线条检测不可用，已保留固定模板。')
      })
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
    const nextQueue = buildVerificationQueue(normalizedResult)
    setResult(normalizedResult)
    setOverlayMode('low')
    setSelectedEntryId(preferredSelectionId(normalizedResult, nextQueue))
    setVerificationState({})
    setVerificationQueue(nextQueue)
    setReviewHistory([])
    setReviewNotice('')
    setPreflightGridCut(normalizedResult.gridCut ?? null)
    preflightGridCutRef.current = normalizedResult.gridCut ?? null
    const nextReadiness =
      normalizedResult.gridCut
        ? summarizeGridCutPreviewReadiness(normalizedResult.gridCut, activePaperTemplate)
        : null
    setPreflightReadiness(
      nextReadiness,
    )
    preflightReadinessRef.current = nextReadiness
    clearPreflightTask()
    setIsPreflighting(false)
    if (!findSampleCaseByImageUrl(nextImageUrl)) {
      saveLastImage(nextImageUrl)
      saveLastResult(normalizedResult)
    }
  }

  async function detectGridCutSafely(dataUrl: string) {
    try {
      return await detectLedgerGridFromImage(dataUrl, activePaperTemplate)
    } catch {
      return null
    }
  }

  async function maybeApplyPriorityCropOcr(
    nextResult: RecognitionResult,
    sourceImageDataUrl: string,
  ) {
    if (!nextResult.visualTokens?.length || !nextResult.calculationProgram) {
      return {
        ...nextResult,
        cropOcrExecution: {
          status: 'skipped' as const,
          sentCropCount: 0,
          returnedTokenCount: 0,
          note: '当前结果没有可融合的小图 OCR token，已跳过。',
        },
      }
    }

    const plan = buildCropOcrPlan(nextResult, activePaperTemplate)
    const tasks = plan.tasks.filter((task) => task.shouldSend).slice(0, priorityCropOcrLimit)
    if (!tasks.length) {
      return {
        ...nextResult,
        cropOcrExecution: {
          status: 'skipped' as const,
          sentCropCount: 0,
          returnedTokenCount: 0,
          note: '当前整页和切格证据已足够稳定，本轮未追加小图 OCR。',
        },
      }
    }

    try {
      const cropReview = await reviewPriorityCellCrops({
        apiBaseUrl: settings.apiBaseUrl,
        apiKey: settings.apiKey.trim(),
        apiMode: settings.apiMode,
        imageDataUrl: sourceImageDataUrl,
        model: activeModel,
        prompt: recognitionPrompt,
        tasks,
      })
      const reviewed = applyCropOcrReview(nextResult, cropReview.externalTokens)
      const auditNotes = Array.from(
        new Set([
          ...reviewed.auditNotes,
          `小图 OCR 复核：本轮追加送审 ${tasks.length} 格，优先处理切格低置信或疑似漏字格。`,
          ...cropReview.auditNotes,
        ]),
      )
      return normalizeLedgerResult({
        ...reviewed,
        auditNotes,
        cropOcrExecution: {
          status: 'completed' as const,
          sentCropCount: tasks.length,
          returnedTokenCount: cropReview.externalTokens.length,
          note: `已追加复核 ${tasks.length} 格，回收 ${cropReview.externalTokens.length} 条候选。`,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '小图 OCR 复核失败。'
      return {
        ...nextResult,
        auditNotes: Array.from(
          new Set([...nextResult.auditNotes, `小图 OCR 复核未完成：${message}`]),
        ),
        cropOcrExecution: {
          status: 'failed' as const,
          sentCropCount: tasks.length,
          returnedTokenCount: 0,
          note: `小图 OCR 复核失败：${message}`,
        },
      }
    }
  }

  async function runDatePreflightSafely(
    sourceImageDataUrl: string,
  ): Promise<{
    report: LocalDatePreflightReport | null
    shouldHold: boolean
    notice: string
  }> {
    if (!settings.localDatePreflightEnabled) {
      return { report: null, shouldHold: false, notice: '' }
    }

    try {
      const report = await runLocalDatePreflight({
        imageDataUrl: sourceImageDataUrl,
        endpoint: settings.localDatePreflightUrl,
      })
      if (shouldHoldForLocalDatePreflight(report)) {
        const missing = report.datesMissing.length
          ? `缺 ${report.datesMissing.slice(0, 8).join('、')}${report.datesMissing.length > 8 ? ' 等' : ''} 日`
          : '日期列未能确认 1-31 齐全'
        return {
          report,
          shouldHold: true,
          notice: `日期预审接口：${missing}，已先停在本地复核，未送整页 OCR。`,
        }
      }
      return {
        report,
        shouldHold: false,
        notice: `日期预审接口通过：${report.dateRange}（${report.dateCount}/31）。`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '日期预审接口不可用。'
      return {
        report: null,
        shouldHold: true,
        notice: `日期预审接口未完成：${message} 已先停在本地复核，避免误送整页 OCR。`,
      }
    }
  }

  async function runRecognition(forceModelCall = false) {
    if (!imageDataUrlRef.current && preflightTaskRef.current) {
      await preflightTaskRef.current
    }

    const currentImageDataUrl = imageDataUrlRef.current
    const currentPreprocessedImageDataUrl = preprocessedImageDataUrlRef.current

    if (!currentImageDataUrl) {
      setError('先拍照或加载测试案例，再开始计算。')
      return
    }

    if (!settings.apiKey.trim()) {
      if (settings.apiMode === 'mockLocal') {
        // mockLocal does not require an API key.
      } else {
        setShowSettings(true)
        setError('请先在设置中填写 API Key。密钥只保存在当前设备。')
        return
      }
    }

    setIsRecognizing(true)
    setRecognitionElapsedSeconds(0)
    setRecognitionStage('正在准备照片')
    setError('')
    const startedAt = Date.now()
    try {
      const sourceImageForCut = currentPreprocessedImageDataUrl || currentImageDataUrl
      let gridCut = preflightGridCutRef.current
      let readiness = preflightReadinessRef.current
      if ((!gridCut || !readiness) && preflightTaskRef.current) {
        setRecognitionStage('正在定位账本格子')
        const pending = await preflightTaskRef.current
        gridCut = preflightGridCutRef.current ?? pending.gridCut
        readiness = preflightReadinessRef.current ?? pending.readiness
      }
      if (!gridCut) {
        setRecognitionStage('正在定位账本格子')
        const snapshot = await startPreflight(sourceImageForCut)
        gridCut = snapshot.gridCut
        readiness = snapshot.readiness
      }
      const shouldHold =
        readiness?.modelGate === 'hold' ||
        (!readiness && shouldHoldForManualGridReview(gridCut))
      const datePreflight = !forceModelCall && !shouldHold
        ? await runDatePreflightSafely(currentImageDataUrl)
        : { report: null, shouldHold: false, notice: '' }
      if (!forceModelCall && (shouldHold || datePreflight.shouldHold)) {
        setRecognitionStage('正在生成本地核查页')
        armPreviewOverrideLock()
        window.setTimeout(() => {
          commitLocalCuttingPreview(gridCut, datePreflight.notice ? [datePreflight.notice] : [])
          setError('')
          setReviewNotice(
            datePreflight.notice ||
              '已自动切到本地复核，当前还没送 OCR，也没有消耗 token。先对照大图和切格小图抽查；如仍要继续，可点“仍然送模型识别”。',
          )
        }, 450)
        return
      }

      setRecognitionStage('正在请求服务器识别整页')
      const nextResult = await recognizeLedgerImage({
        apiBaseUrl: settings.apiBaseUrl,
        apiKey: settings.apiKey.trim(),
        apiMode: settings.apiMode,
        imageDataUrl: currentImageDataUrl,
        preprocessedImageDataUrl: currentPreprocessedImageDataUrl,
        model: activeModel,
        prompt: recognitionPrompt,
        qualityMode: activeQualityMode,
      })
      const preflightAuditNotes = datePreflight.notice ? [datePreflight.notice] : []
      const withGridCut = normalizeLedgerResult({
        ...nextResult,
        auditNotes: Array.from(new Set([...(nextResult.auditNotes ?? []), ...preflightAuditNotes])),
        gridCut: gridCut ?? undefined,
      })
      setRecognitionStage('正在整理计算结果')
      const finalResult =
        activeQualityMode === 'max' && settings.priorityCropOcrEnabled
          ? (setRecognitionStage('正在复核高风险格'), await maybeApplyPriorityCropOcr(withGridCut, sourceImageForCut))
          : withGridCut
      setRecognitionStage('正在打开核查界面')
      applyResult(finalResult)
      if (activeSampleCase) {
        const nextBenchmark = evaluateSampleCaseBenchmark(finalResult, activeSampleCase)
        recordModelRun({
          apiMode: settings.apiMode,
          benchmark: nextBenchmark,
          durationMs: Date.now() - startedAt,
          model: activeModel,
          qualityMode: activeQualityMode,
          status: 'success',
        })
      }
    } catch (recognitionError) {
      const message = recognitionError instanceof Error ? recognitionError.message : '识别失败。'
      setRecognitionStage('计算失败')
      setError(message)
      if (activeSampleCase) {
        recordModelRun({
          apiMode: settings.apiMode,
          durationMs: Date.now() - startedAt,
          error: message,
          model: activeModel,
          qualityMode: activeQualityMode,
          status: 'error',
        })
      }
    } finally {
      setIsPreflighting(false)
      setIsRecognizing(false)
      setRecognitionElapsedSeconds(0)
      window.setTimeout(() => setRecognitionStage(''), 250)
    }
  }

  function continueRecognitionFromPreview() {
    if (previewOverrideLockedRef.current) {
      return Promise.resolve()
    }
    return runRecognition(true)
  }

  async function checkApiReadiness() {
    if (!canRunWithoutApiKey && !settings.apiKey.trim()) {
      setShowSettings(true)
      setApiSelfCheck({
        status: 'failed',
        checkedAt: new Date().toISOString(),
        mode: settings.apiMode,
        baseUrl: settings.apiBaseUrl.trim() || 'https://api.openai.com',
        model: activeModel,
        note: '请先填写 API Key，再做低耗接口自检。',
      })
      return
    }

    setIsCheckingApi(true)
    try {
      const report = await runApiSelfCheck({
        apiBaseUrl: settings.apiBaseUrl,
        apiKey: settings.apiKey.trim(),
        apiMode: settings.apiMode,
        model: activeModel,
      })
      setApiSelfCheck(report)
    } finally {
      setIsCheckingApi(false)
    }
  }

  async function runModelBenchmarkSuite() {
    if (!settings.apiKey.trim()) {
      if (settings.apiMode !== 'mockLocal') {
        setError('先填写 API Key，再运行模型实验。')
        return
      }
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
    const benchmarkGridCut = await detectGridCutSafely(nextPreprocessed || dataUrl)
    setPreflightGridCut(benchmarkGridCut)
    preflightGridCutRef.current = benchmarkGridCut
    const benchmarkReadiness =
      benchmarkGridCut ? summarizeGridCutPreviewReadiness(benchmarkGridCut, activePaperTemplate) : null
    setPreflightReadiness(benchmarkReadiness)
    preflightReadinessRef.current = benchmarkReadiness
    clearPreflightTask()
    setIsPreflighting(false)

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
            bestResult = { ...candidateResult, gridCut: benchmarkGridCut ?? undefined }
            applyResult(bestResult, DEFAULT_SAMPLE_CASE.imageUrl)
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
    if (targetCell && !activeSampleCase) {
      void captureCellTrainingSample({
        cell: targetCell,
        imageDataUrl: preprocessedImageDataUrlRef.current || imageDataUrlRef.current,
        label: normalized,
        result,
        semanticType:
          targetCell.semanticType === 'blank' || targetCell.semanticType === 'uncertain'
            ? 'quantity'
            : targetCell.semanticType,
      }).catch(() => {})
    }
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
    const targetCell = result.cells?.find((cell) => cell.id === cellId)
    if (targetCell && !activeSampleCase) {
      void captureCellTrainingSample({
        cell: targetCell,
        imageDataUrl: preprocessedImageDataUrlRef.current || imageDataUrlRef.current,
        label: normalized,
        result,
        semanticType,
      }).catch(() => {})
    }
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
    apiSelfCheck,
    benchmark,
    deleteCurrentPrompt,
    downloadJson,
    cropOcrPlan,
    error,
    handleFile,
    imageUrl,
    isBenchmarking,
    isCheckingApi,
    isRecognizing,
    loadSample,
    benchmarkProgress,
    recognitionElapsedSeconds,
    recognitionStage,
    canContinueFromPreview,
    isPreviewOverrideLocked,
    canUndoReview: reviewHistory.length > 0,
    checkApiReadiness,
    confirmVerification,
    correctVerificationValue,
    modelRuns,
    overlayMode,
    prompt,
    preflightGridCut,
    preflightReadiness,
    isPreflighting,
    shouldHoldForRecognition:
      preflightReadiness?.modelGate === 'hold' ||
      (preflightReadiness === null && shouldHoldForManualGridReview(preflightGridCut)),
    previewLocalCutting,
    reviewImageUrl: imageUrl || preprocessedImageUrl,
    result,
    reviewNotice,
    runModelBenchmarkSuite,
    sampleCases: SAMPLE_CASES,
    continueRecognitionFromPreview,
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
