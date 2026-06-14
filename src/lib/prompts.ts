import { DEFAULT_PROMPTS } from '../data/defaultPrompts'
import type { AppSettings, SmartPrompt } from '../types'

export function activePrompt(settings: AppSettings): SmartPrompt {
  return (
    settings.prompts.find((prompt) => prompt.id === settings.selectedPromptId) ??
    settings.prompts[0] ??
    DEFAULT_PROMPTS[0]
  )
}

export function createPromptId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `prompt-${Date.now()}`
}

export function createBlankPrompt(): SmartPrompt {
  return {
    id: createPromptId(),
    name: '新的智能 prompt',
    emoji: 'lightBulb',
    description: '自定义这一本固定账本的识别细节。',
    prompt:
      '请识别一张完整单页固定账本，先确认表格四角、表头单价行和 1日至31日都可见，再按固定格子抽取明细、置信度、不确定字符和最终合计。',
  }
}

export function normalizePrompts(prompts: SmartPrompt[] | undefined) {
  if (!prompts?.length) return DEFAULT_PROMPTS
  const deprecatedDefaultPromptIds = new Set(['receipt', 'split-bill'])

  const normalized = prompts
    .filter((prompt) => !deprecatedDefaultPromptIds.has(prompt.id))
    .map((prompt) => {
      const defaultPrompt = DEFAULT_PROMPTS.find((item) => item.id === prompt.id)
      if (!defaultPrompt) return prompt

      if (
        prompt.id === 'handwritten-ledger' &&
        (!prompt.prompt.includes('完整单页') || !prompt.prompt.includes('31日'))
      ) {
        return defaultPrompt
      }

      return { ...defaultPrompt, ...prompt, prompt: defaultPrompt.prompt, description: defaultPrompt.description }
    })

  return normalized.length ? normalized : DEFAULT_PROMPTS
}
