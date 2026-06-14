import { Eye, LoaderCircle, WandSparkles } from 'lucide-react'

interface ActionBarProps {
  hasImage: boolean
  isRecognizing: boolean
  onPreviewCutting: () => void
  onRunRecognition: () => void
}

export function ActionBar({
  hasImage,
  isRecognizing,
  onPreviewCutting,
  onRunRecognition,
}: ActionBarProps) {
  return (
    <div className="action-stack">
      <button
        className="primary-button"
        type="button"
        disabled={!hasImage || isRecognizing}
        onClick={onRunRecognition}
      >
        {isRecognizing ? <LoaderCircle className="spin-icon" size={18} /> : <WandSparkles size={18} />}
        {isRecognizing ? '正在仔细识别并复核…' : '开始计算'}
      </button>
      <button
        className="ghost-button cutting-preview-button"
        type="button"
        disabled={!hasImage || isRecognizing}
        onClick={onPreviewCutting}
      >
        <Eye size={17} />
        本地切割预览
      </button>
    </div>
  )
}
