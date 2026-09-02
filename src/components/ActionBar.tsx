import { Eye, LoaderCircle, WandSparkles } from 'lucide-react'

interface ActionBarProps {
  hasImage: boolean
  isRecognizing: boolean
  oneTapMode?: boolean
  recognitionElapsedSeconds?: number
  recognitionStage?: string
  onPreviewCutting: () => void
  onRunRecognition: () => void
}

export function ActionBar({
  hasImage,
  isRecognizing,
  oneTapMode = false,
  recognitionElapsedSeconds = 0,
  recognitionStage = '',
  onPreviewCutting,
  onRunRecognition,
}: ActionBarProps) {
  const waitingHint =
    recognitionElapsedSeconds >= 60
      ? '服务器还在识别这张整页账本，请不要重复提交。'
      : recognitionElapsedSeconds >= 25
        ? '整页手写识别会比较慢，当前请求仍在进行。'
        : '正在处理当前照片。'

  return (
    <div className="action-stack">
      <button
        className="primary-button"
        type="button"
        disabled={!hasImage || isRecognizing}
        onClick={() => onRunRecognition()}
      >
        {isRecognizing ? <LoaderCircle className="spin-icon" size={18} /> : <WandSparkles size={18} />}
        {isRecognizing ? '正在计算…' : '开始计算'}
      </button>
      {isRecognizing ? (
        <div className="recognition-progress" role="status" aria-live="polite">
          <div>
            <span>{recognitionStage || '正在开始计算'}</span>
            <strong>{recognitionElapsedSeconds}s</strong>
          </div>
          <p>{waitingHint}</p>
          <i aria-hidden="true" />
        </div>
      ) : null}
      {!oneTapMode ? (
        <button
          className="ghost-button cutting-preview-button"
          type="button"
          disabled={!hasImage || isRecognizing}
          onClick={onPreviewCutting}
        >
          <Eye size={17} />
          单页切割预览
        </button>
      ) : null}
    </div>
  )
}
