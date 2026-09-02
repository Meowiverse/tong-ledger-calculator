import { ChevronDown, LoaderCircle, ShieldCheck, TestTubeDiagonal } from 'lucide-react'
import { productColumnsFromText, productColumnsToText } from '../lib/paperTemplates'
import { PromptManager } from './PromptManager'
import type { ApiSelfCheckReport, AppSettings, PaperTemplate, SmartPrompt } from '../types'

interface SettingsPanelProps {
  activePaperTemplate: PaperTemplate
  apiSelfCheck: ApiSelfCheckReport | null
  isCheckingApi: boolean
  prompt: SmartPrompt
  settings: AppSettings
  onAddPrompt: () => void
  onCheckApi: () => void
  onDeletePrompt: () => void
  onUpdatePaperTemplate: (
    patch: Partial<PaperTemplate> | ((template: PaperTemplate) => PaperTemplate),
  ) => void
  onUpdatePrompt: (patch: Partial<SmartPrompt>) => void
  onUpdateSettings: (patch: Partial<AppSettings>) => void
}

export function SettingsPanel({
  activePaperTemplate,
  apiSelfCheck,
  isCheckingApi,
  prompt,
  settings,
  onAddPrompt,
  onCheckApi,
  onDeletePrompt,
  onUpdatePaperTemplate,
  onUpdatePrompt,
  onUpdateSettings,
}: SettingsPanelProps) {
  const productColumnText = productColumnsToText(activePaperTemplate.productColumns)
  const apiModeHint =
    settings.apiMode === 'mockLocal'
      ? '本地 mock 会直接返回内置样例结果，用来验证 max 全链路，不会发真实网络请求。'
      : '兼容接口会请求 /v1/chat/completions；API 地址可填域名或完整到 /v1。'
  const qualityPathLabel =
    settings.apiMode === 'mockLocal'
      ? '本地 mock 不消耗 token，可完整演练整页识别、小图 OCR 和人工审核'
      : settings.qualityMode === 'fast'
      ? '本地切格 0 token，模型只读整页 1 次'
      : settings.qualityMode === 'high'
      ? '本地切格 0 token，模型整页读取后再做复核'
        : `本地切格 0 token，整页读取后最多再发 ${settings.priorityCropOcrLimit} 张小图`
  const localPreflightHint = settings.localDatePreflightEnabled
    ? '已启用日期预审接口；送整页前会先确认 1-31 日期行。'
    : '可连接服务器日期预审接口，先拦住缺页或日期风险图。'
  const apiCheckHint =
    settings.apiMode === 'mockLocal'
      ? '0 token，只确认当前已切到本地 mock 路径。'
      : '只发一条极短文本请求，先检查鉴权、接口格式和模型名是否通。'

  return (
    <section className="settings-panel">
      <div className="settings-grid">
        <div className="model-lock">
          <ShieldCheck size={18} />
          <div>
            <strong>{settings.apiMode === 'mockLocal' ? '本地 mock 识别' : 'OpenAI 兼容接口'}</strong>
            <span>{settings.model || '填写模型名'} / {settings.qualityMode} 档识别</span>
            <p className="field-hint">{qualityPathLabel}</p>
          </div>
        </div>
        <div className="field">
          <label htmlFor="api-key">API Key</label>
          <input
            id="api-key"
            type="password"
            placeholder="sk-..."
            value={settings.apiKey}
            disabled={settings.apiMode === 'mockLocal'}
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
            disabled={settings.apiMode === 'mockLocal'}
            onChange={(event) => onUpdateSettings({ apiBaseUrl: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="api-model">模型名</label>
          <input
            id="api-model"
            placeholder={settings.apiMode === 'mockLocal' ? 'mock-local-max' : 'gpt-4o / gemini-2.5-flash / qwen-vl-max'}
            value={settings.model}
            onChange={(event) => onUpdateSettings({ model: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="quality-mode">识别档位</label>
          <select
            id="quality-mode"
            value={settings.qualityMode}
            onChange={(event) =>
              onUpdateSettings({ qualityMode: event.target.value as AppSettings['qualityMode'] })
            }
          >
            <option value="fast">fast - 只做整页读取</option>
            <option value="high">high - 整页读取 + 复核</option>
            <option value="max">max - 整页 + 复核 + 小图 OCR</option>
          </select>
          <p className="field-hint">测试省 token 先用 fast 或 high，正式冲准确率再开 max。</p>
        </div>
        <div className="field">
          <label htmlFor="crop-ocr-limit">小图 OCR 上限</label>
          <input
            id="crop-ocr-limit"
            type="number"
            min="0"
            max="24"
            value={settings.priorityCropOcrLimit}
            onChange={(event) =>
              onUpdateSettings({ priorityCropOcrLimit: Number(event.target.value || 0) })
            }
          />
          <p className="field-hint">仅在 max 档生效。建议 4-8 张，避免测试时 token 开销过大。</p>
        </div>
        <div className="template-rule-grid">
          <label>
            <input
              type="checkbox"
              checked={settings.localDatePreflightEnabled}
              onChange={(event) =>
                onUpdateSettings({ localDatePreflightEnabled: event.target.checked })
              }
            />
            日期预审接口
          </label>
        </div>
        <div className="field">
          <label htmlFor="local-date-preflight-url">日期预审地址</label>
          <input
            id="local-date-preflight-url"
            type="url"
            value={settings.localDatePreflightUrl}
            disabled={!settings.localDatePreflightEnabled}
            onChange={(event) => onUpdateSettings({ localDatePreflightUrl: event.target.value })}
          />
          <p className="field-hint">{localPreflightHint}</p>
        </div>
        <div className={`api-self-check ${apiSelfCheck ? `is-${apiSelfCheck.status}` : ''}`}>
          <div className="api-self-check-head">
            <div>
              <strong>低耗接口自检</strong>
              <span>{apiCheckHint}</span>
            </div>
            <button
              className="ghost-button"
              type="button"
              disabled={isCheckingApi}
              onClick={onCheckApi}
            >
              {isCheckingApi ? <LoaderCircle className="spin-icon" size={16} /> : <TestTubeDiagonal size={16} />}
              {isCheckingApi ? '自检中…' : '开始自检'}
            </button>
          </div>
          {apiSelfCheck ? (
            <p className="api-self-check-note" role="status">
              <b>{apiSelfCheck.status === 'passed' ? '通过' : '失败'}</b>
              <span>{apiSelfCheck.note}</span>
            </p>
          ) : null}
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
            <option value="mockLocal">本地 mock（不消耗 token）</option>
          </select>
          <p className="field-hint">{apiModeHint}</p>
        </div>
        <div className="template-rule-grid">
          <label>
            <input
              type="checkbox"
              checked={settings.priorityCropOcrEnabled}
              onChange={(event) =>
                onUpdateSettings({ priorityCropOcrEnabled: event.target.checked })
              }
            />
            启用高风险格小图 OCR 复核
          </label>
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
