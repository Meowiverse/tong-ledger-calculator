import { FlaskConical, LoaderCircle } from 'lucide-react'
import type { ModelRunRecord } from '../types'

interface ModelRunHistoryProps {
  benchmarkMode: string
  isBenchmarking: boolean
  onRunModelSuite: () => void
  progress: string
  runs: ModelRunRecord[]
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${durationMs}ms`
  return `${Math.round(durationMs / 1000)}s`
}

function formatRunTime(isoTime: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoTime))
}

export function ModelRunHistory({
  benchmarkMode,
  isBenchmarking,
  onRunModelSuite,
  progress,
  runs,
}: ModelRunHistoryProps) {
  return (
    <section className="model-run-panel">
      <div className="panel-title">
        <h2>稳定性测试</h2>
        <span>{runs.length}</span>
      </div>
      <button
        className="suite-button"
        disabled={isBenchmarking}
        type="button"
        onClick={onRunModelSuite}
      >
        {isBenchmarking ? <LoaderCircle className="spin-icon" size={16} /> : <FlaskConical size={16} />}
        {isBenchmarking ? progress || '运行中' : '连续运行 3 次'}
      </button>
      <p className="empty-runs">实验室稳定性测试最多跑到 {benchmarkMode} 档，避免把小图 OCR token 成本重复放大。</p>
      <div className="model-run-list">
        {runs.length ? (
          runs.slice(0, 6).map((run) => (
            <div className={`model-run ${run.status}`} key={run.id}>
              <div>
                <strong>{run.model}</strong>
                <span>
                  深度复核 · {formatDuration(run.durationMs)}
                </span>
              </div>
              {run.status === 'success' && run.benchmark ? (
                <div className="run-score">
                  <b>{run.benchmark.totalScore.toFixed(1)}</b>
                  <span>{run.benchmark.totalError >= 0 ? '+' : ''}{run.benchmark.totalError.toFixed(2)}</span>
                </div>
              ) : (
                <div className="run-error" title={run.error}>
                  失败
                </div>
              )}
              <time>{formatRunTime(run.createdAt)}</time>
            </div>
          ))
        ) : (
          <p className="empty-runs">连续运行同一案例，检查结果是否稳定。</p>
        )}
      </div>
    </section>
  )
}
