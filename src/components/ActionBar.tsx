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
        {isRecognizing ? '正在识别整页并复核…' : '识别整页账本'}
      </button>
      <button
        className="ghost-button cutting-preview-button"
        type="button"
        disabled={!hasImage || isRecognizing}
        onClick={onPreviewCutting}
      >
        <Eye size={17} />
        单页切割预览
      </button>
    </div>
  )
}
