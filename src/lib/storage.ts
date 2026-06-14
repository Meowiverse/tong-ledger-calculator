import { DEFAULT_PROMPTS } from '../data/defaultPrompts'
import { RECOGNITION_MODEL, RECOGNITION_QUALITY } from '../recognitionConfig'
import {
  DEFAULT_PAPER_TEMPLATE,
  DEFAULT_PAPER_TEMPLATE_ID,
  normalizePaperTemplates,
} from './paperTemplates'
import { normalizePrompts } from './prompts'
import type { AppSettings, ModelRunRecord, RecognitionResult } from '../types'

const SETTINGS_KEY = 'tong-ledger-settings-v1'
const LAST_RESULT_KEY = 'tong-ledger-last-result-v5'
const LAST_IMAGE_KEY = 'tong-ledger-last-image-v3'
const MODEL_RUNS_KEY = 'tong-ledger-model-runs-v1'
const MAX_MODEL_RUNS = 20

export const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  apiMode: 'chatCompletions',
  model: RECOGNITION_MODEL,
  qualityMode: RECOGNITION_QUALITY,
  selectedPromptId: DEFAULT_PROMPTS[0].id,
  prompts: DEFAULT_PROMPTS,
  selectedPaperTemplateId: DEFAULT_PAPER_TEMPLATE_ID,
  paperTemplates: [DEFAULT_PAPER_TEMPLATE],
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const prompts = normalizePrompts(parsed.prompts)
    const paperTemplates = normalizePaperTemplates(parsed.paperTemplates)
    const selectedPaperTemplateId =
      parsed.selectedPaperTemplateId &&
      paperTemplates.some((template) => template.id === parsed.selectedPaperTemplateId)
        ? parsed.selectedPaperTemplateId
        : paperTemplates[0].id

    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      model: parsed.model?.trim() || DEFAULT_SETTINGS.model,
      qualityMode: RECOGNITION_QUALITY,
      prompts,
      selectedPromptId:
        parsed.selectedPromptId && prompts.some((prompt) => prompt.id === parsed.selectedPromptId)
          ? parsed.selectedPromptId
          : prompts[0].id,
      paperTemplates,
      selectedPaperTemplateId,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function loadLastResult(): RecognitionResult | null {
  try {
    const raw = localStorage.getItem(LAST_RESULT_KEY)
    return raw ? (JSON.parse(raw) as RecognitionResult) : null
  } catch {
    return null
  }
}

export function saveLastResult(result: RecognitionResult) {
  localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(result))
}

export function loadLastImage(): string {
  try {
    return localStorage.getItem(LAST_IMAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveLastImage(imageUrl: string) {
  localStorage.setItem(LAST_IMAGE_KEY, imageUrl)
}

export function loadModelRuns(): ModelRunRecord[] {
  try {
    const raw = localStorage.getItem(MODEL_RUNS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ModelRunRecord[]) : []
  } catch {
    return []
  }
}

export function saveModelRun(record: ModelRunRecord) {
  const records = [record, ...loadModelRuns()].slice(0, MAX_MODEL_RUNS)
  localStorage.setItem(MODEL_RUNS_KEY, JSON.stringify(records))
  return records
}
