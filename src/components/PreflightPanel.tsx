import { AlertTriangle, CheckCircle2, LoaderCircle, ShieldAlert } from 'lucide-react'
import type { GridCutEvidence } from '../types'
import type { GridCutPreviewReadiness } from '../lib/ledgerCells'

interface PreflightPanelProps {
  gridCut: GridCutEvidence | null
  isRunning: boolean
  readiness: GridCutPreviewReadiness | null
  shouldHold: boolean
}

function tokenHint(
  gridCut: GridCutEvidence | null,
  readiness: GridCutPreviewReadiness | null,
  shouldHold: boolean,
) {
  if (!gridCut) return '上传后会先本地切格预检，再决定要不要动用模型 token。'
  if (shouldHold) return '建议先点单页切割预览或重拍；默认先不消耗模型 token。'
  if (readiness?.modelGate === 'send') return '可直接识别；本地大多数格子已经稳定。'
  if (readiness?.modelGate === 'send-with-review' && readiness.reviewIntensity === 'strong') {
    return '可先识别；优先核对切格低置信格和关键数字列。'
  }
  if (readiness?.modelGate === 'send-with-review') return '可先识别；重点抽查本地低置信格。'
  if (gridCut.level === 'review') return '可直接识别；模型前先知道哪些格需要重点抽查。'
  return '可直接识别；本地切格已经通过。'
}

function statusLabel(
  gridCut: GridCutEvidence | null,
  readiness: GridCutPreviewReadiness | null,
  shouldHold: boolean,
) {
  if (!gridCut) return '等待本地预检'
  if (shouldHold) return '建议先抽查'
  if (readiness?.modelGate === 'send') return '可直接识别'
  if (readiness?.modelGate === 'send-with-review' && readiness.reviewIntensity === 'strong') return '可识别，需强抽查'
  if (readiness?.modelGate === 'send-with-review') return '可识别，建议抽查'
  if (gridCut.level === 'review') return '可识别，建议抽查'
  return '可直接识别'
}

export function PreflightPanel({ gridCut, isRunning, readiness, shouldHold }: PreflightPanelProps) {
  const tone = !gridCut ? 'pending' : shouldHold ? 'hold' : gridCut.level === 'review' ? 'review' : 'good'
  const Icon = !gridCut ? LoaderCircle : shouldHold ? ShieldAlert : gridCut.level === 'review' ? AlertTriangle : CheckCircle2

  return (
    <section
      aria-label="识别前本地预检"
      className={`preflight-panel is-${tone}`}
      role="region"
    >
      <div className="preflight-head">
        <div className="preflight-icon">
          <Icon className={isRunning && !gridCut ? 'spin-icon' : ''} size={18} />
        </div>
        <div>
          <strong>{statusLabel(gridCut, readiness, shouldHold)}</strong>
          <span>{tokenHint(gridCut, readiness, shouldHold)}</span>
        </div>
      </div>

      {gridCut ? (
        <div className="preflight-metrics">
          <div>
            <span>切格分数</span>
            <strong>{gridCut.score}</strong>
          </div>
          <div>
            <span>整页置信</span>
            <strong>{Math.round(gridCut.confidence * 100)}%</strong>
          </div>
          <div>
            <span>{readiness ? (readiness.reviewIntensity === 'strong' ? '关键低置信格' : '低置信格') : '格线证据'}</span>
            <strong>
              {readiness
                ? readiness.reviewIntensity === 'strong'
                  ? `${readiness.ocrCriticalLowCutCellCount}/${readiness.ocrCriticalCellCount}`
                  : `${readiness.lowCutCellCount}/${readiness.reviewableCellCount}`
                : `${gridCut.support.detectedHorizontal} / ${gridCut.support.detectedVertical}`}
            </strong>
          </div>
        </div>
      ) : null}

      <p className="preflight-detail">
        {gridCut
          ? `${gridCut.label} · ${(readiness?.reason ?? gridCut.reasons.slice(0, 2).join('；')) || '正在等待进一步判断'}`
          : isRunning
            ? '正在读取整页格线和模板位置…'
            : '拍完整页后会自动检查四角、行列和模板对齐情况。'}
      </p>
    </section>
  )
}
