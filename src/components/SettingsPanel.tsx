import { ChevronDown, ShieldCheck } from 'lucide-react'
import { productColumnsFromText, productColumnsToText } from '../lib/paperTemplates'
import { PromptManager } from './PromptManager'
import type { AppSettings, PaperTemplate, SmartPrompt } from '../types'

interface SettingsPanelProps {
  activePaperTemplate: PaperTemplate
  prompt: SmartPrompt
  settings: AppSettings
  onAddPrompt: () => void
  onDeletePrompt: () => void
  onUpdatePaperTemplate: (
    patch: Partial<PaperTemplate> | ((template: PaperTemplate) => PaperTemplate),
  ) => void
  onUpdatePrompt: (patch: Partial<SmartPrompt>) => void
  onUpdateSettings: (patch: Partial<AppSettings>) => void
}

export function SettingsPanel({
  activePaperTemplate,
  prompt,
  settings,
  onAddPrompt,
  onDeletePrompt,
  onUpdatePaperTemplate,
  onUpdatePrompt,
  onUpdateSettings,
}: SettingsPanelProps) {
  const productColumnText = productColumnsToText(activePaperTemplate.productColumns)

  return (
    <section className="settings-panel">
      <div className="settings-grid">
        <div className="model-lock">
          <ShieldCheck size={18} />
          <div>
            <strong>OpenAI 兼容接口</strong>
            <span>{settings.model || '填写模型名'} / 三阶段复核</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="api-key">API Key</label>
          <input
            id="api-key"
            type="password"
            placeholder="sk-..."
            value={settings.apiKey}
            onChange={(event) => onUpdateSettings({ apiKey: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="api-base-url">API 地址</label>
          <input
            id="api-base-url"
            type="url"
            placeholder="https://api.openai.com/v1"
            value={settings.apiBaseUrl}
            onChange={(event) => onUpdateSettings({ apiBaseUrl: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="api-model">模型名</label>
          <input
            id="api-model"
            placeholder="gpt-4o / gemini-2.5-flash / qwen-vl-max"
            value={settings.model}
            onChange={(event) => onUpdateSettings({ model: event.target.value })}
          />
        </div>
      </div>

      <details className="settings-details">
        <summary>
          <span>纸张与接口设置</span>
          <ChevronDown size={17} />
        </summary>
        <div className="paper-template-editor">
          <div className="paper-template-head">
            <div>
              <strong>固定账本格式</strong>
              <span>一种本子，{activePaperTemplate.rowCount} 个日期行，自动切割后重建表格。</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="paper-columns">纸类列与单价</label>
            <textarea
              id="paper-columns"
              value={productColumnText}
              onChange={(event) =>
                onUpdatePaperTemplate((template) => ({
                  ...template,
                  productColumns: productColumnsFromText(event.target.value),
                }))
              }
            />
            <p className="field-hint">每行一个纸类，格式为“名称=单价”。不填单价时读取图片第一行。</p>
          </div>
          <div className="template-rule-grid">
            <label>
              <input
                type="checkbox"
                checked={activePaperTemplate.rules.firstColumnIsAttendance}
                onChange={(event) =>
                  onUpdatePaperTemplate((template) => ({
                    ...template,
                    rules: { ...template.rules, firstColumnIsAttendance: event.target.checked },
                  }))
                }
              />
              第一列为上班/没上班
            </label>
            <label>
              <input
                type="checkbox"
                checked={activePaperTemplate.rules.unloadingAlreadyCalculated}
                onChange={(event) =>
                  onUpdatePaperTemplate((template) => ({
                    ...template,
                    rules: { ...template.rules, unloadingAlreadyCalculated: event.target.checked },
                  }))
                }
              />
              上下货是已算好的金额
            </label>
            <label>
              <input
                type="checkbox"
                checked={activePaperTemplate.rules.deductionsAreSeparateAdjustments}
                onChange={(event) =>
                  onUpdatePaperTemplate((template) => ({
                    ...template,
                    rules: {
                      ...template.rules,
                      deductionsAreSeparateAdjustments: event.target.checked,
                    },
                  }))
                }
              />
              扣款单独扣减
            </label>
          </div>
        </div>
        <div className="field">
          <label htmlFor="api-mode">接口格式</label>
          <select
            id="api-mode"
            value={settings.apiMode}
            onChange={(event) =>
              onUpdateSettings({ apiMode: event.target.value as AppSettings['apiMode'] })
            }
          >
            <option value="chatCompletions">OpenAI 兼容接口</option>
            <option value="responses">Responses 接口</option>
          </select>
          <p className="field-hint">
            兼容接口会请求 <code>/v1/chat/completions</code>；API 地址可填域名或完整到
            <code>/v1</code>。
          </p>
        </div>
        <PromptManager
          prompt={prompt}
          settings={settings}
          onAddPrompt={onAddPrompt}
          onDeletePrompt={onDeletePrompt}
          onUpdatePrompt={onUpdatePrompt}
          onUpdateSettings={onUpdateSettings}
        />
      </details>
    </section>
  )
}
