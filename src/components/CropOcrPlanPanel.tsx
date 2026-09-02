import { cropOcrTaskLabel, cropOcrTaskReasonLine } from '../lib/cropOcrPlan'
import type { CropOcrExecution, CropOcrPlan } from '../types'

interface CropOcrPlanPanelProps {
  compact?: boolean
  developerMode?: boolean
  execution?: CropOcrExecution
  plan: CropOcrPlan
}

export function CropOcrPlanPanel({
  compact = false,
  developerMode = false,
  execution,
  plan,
}: CropOcrPlanPanelProps) {
  const recommendedTasks = plan.tasks.filter((task) => task.shouldSend).slice(0, compact ? 3 : 5)

  return (
    <section
      aria-label={developerMode ? '小图 OCR 计划（实验室）' : '小图 OCR 计划'}
      className={`crop-ocr-panel ${compact ? 'is-compact' : ''}`}
      role="region"
    >
      <div className="crop-ocr-head">
        <div>
          <span>小图 OCR 计划</span>
          <strong>{plan.tokenBudgetLabel}</strong>
        </div>
        <b>{plan.recommendedCropCount} 格</b>
      </div>
      <div className="crop-ocr-grid">
        <div>
          <span>优先送 OCR</span>
          <strong>{plan.recommendedCropCount}</strong>
        </div>
        <div>
          <span>延后观察</span>
          <strong>{plan.deferredCropCount}</strong>
        </div>
        <div>
          <span>预估节省</span>
          <strong>{Math.round(plan.estimatedSavingsRatio * 100)}%</strong>
        </div>
      </div>
      <ul className="crop-ocr-notes">
        {execution ? <li>{execution.note}</li> : null}
        {plan.notes.slice(0, compact ? 2 : 4).map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      {developerMode || !compact ? (
        <div className="crop-ocr-tasks">
          {recommendedTasks.map((task) => (
            <div className={`crop-ocr-task is-${task.priority}`} key={task.cellId}>
              <strong>{cropOcrTaskLabel(task)}</strong>
              <span>{cropOcrTaskReasonLine(task)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
