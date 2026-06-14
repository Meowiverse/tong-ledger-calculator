import { ChevronDown, FlaskConical } from 'lucide-react'
import './App.css'
import './Responsive.css'
import { ActionBar } from './components/ActionBar'
import { BrandHeader } from './components/BrandHeader'
import { EntryTable } from './components/EntryTable'
import { HeroCapture } from './components/HeroCapture'
import { ImageReview } from './components/ImageReview'
import { ModelRunHistory } from './components/ModelRunHistory'
import { ReconstructedLedgerTable } from './components/ReconstructedLedgerTable'
import { ResultSummary } from './components/ResultSummary'
import { SettingsPanel } from './components/SettingsPanel'
import { UxScorePanel } from './components/UxScorePanel'
import { VerificationCard } from './components/VerificationCard'
import { useLedgerApp } from './hooks/useLedgerApp'
import { formatAmount } from './lib/calculation'

function App() {
  const app = useLedgerApp()
  const labMode = new URLSearchParams(window.location.search).get('lab') === '1'
  const hasImage = Boolean(app.imageUrl)
  const hasResult = Boolean(app.result && app.summary)

  return (
    <main className="app-shell">
      <div className="phone-frame">
        <section className="main-flow">
          <BrandHeader onToggleSettings={() => app.setShowSettings((value) => !value)} />

          {app.showSettings ? (
            <SettingsPanel
              activePaperTemplate={app.activePaperTemplate}
              prompt={app.prompt}
              settings={app.settings}
              onAddPrompt={app.addPrompt}
              onDeletePrompt={app.deleteCurrentPrompt}
              onUpdatePaperTemplate={app.updateActivePaperTemplate}
              onUpdatePrompt={app.updateCurrentPrompt}
              onUpdateSettings={app.updateSettings}
            />
          ) : null}

          {!hasResult ? (
            <HeroCapture
              hasImage={hasImage}
              imageUrl={app.reviewImageUrl}
              prompt={app.prompt}
              settings={app.settings}
              onFile={app.handleFile}
              onUpdateSettings={app.updateSettings}
            />
          ) : null}

          {!hasResult ? (
            <ActionBar
              hasImage={hasImage}
              isRecognizing={app.isRecognizing}
              onPreviewCutting={app.previewLocalCutting}
              onRunRecognition={app.runRecognition}
            />
          ) : null}

          {app.error ? <div className="error-box">{app.error}</div> : null}

          {hasResult && app.result && app.summary && !app.activeVerificationItem ? (
            <ResultSummary
              result={app.result}
              reviewCount={app.verificationQueue.length}
              summary={app.summary}
            />
          ) : null}

          {hasResult && app.result && app.summary && app.activeVerificationItem ? (
            <div className="review-total-note">
              <div>
                <span>当前合计</span>
                <strong>{formatAmount(app.summary.total, app.result.currency)}</strong>
              </div>
              <p>{app.verificationProgress.remaining} 处待确认，修改后自动重算。</p>
            </div>
          ) : null}

          {hasResult && app.result && app.imageUrl ? (
            <section className="review-workspace">
              <ImageReview
                imageUrl={app.reviewImageUrl}
                currentNumber={Math.min(
                  app.verificationProgress.completed + 1,
                  app.verificationProgress.total,
                )}
                paperTemplate={app.activePaperTemplate}
                result={app.result}
                selectedEntryId={app.selectedEntryId}
              />
              <VerificationCard
                key={app.activeVerificationItem?.id ?? 'review-complete'}
                canUndo={app.canUndoReview}
                item={app.activeVerificationItem}
                notice={app.reviewNotice}
                progress={app.verificationProgress}
                result={app.result}
                onConfirm={app.confirmVerification}
                onCorrectValue={app.correctVerificationValue}
                onSkip={app.skipVerification}
                onUndo={app.undoLastReview}
              />
            </section>
          ) : null}

          {hasResult && app.result ? (
            <ReconstructedLedgerTable
              imageUrl={app.reviewImageUrl}
              paperTemplate={app.activePaperTemplate}
              result={app.result}
              selectedEntryId={app.selectedEntryId}
              onSelectEntry={app.setSelectedEntryId}
              onUpdateCell={app.updateCellValue}
            />
          ) : null}

          {hasResult && app.result ? (
            <details className="details-panel">
              <summary>
                <span>查看全部明细</span>
                <span>{app.result.entries.length} 笔</span>
                <ChevronDown size={18} />
              </summary>
              <EntryTable
                result={app.result}
                selectedEntryId={app.selectedEntryId}
                onSelectEntry={app.setSelectedEntryId}
              />
            </details>
          ) : null}

          {hasResult ? (
            <div className="result-actions">
              <HeroCapture
                compact
                hasImage
                imageUrl={app.reviewImageUrl}
                prompt={app.prompt}
                settings={app.settings}
                onFile={app.handleFile}
                onUpdateSettings={app.updateSettings}
              />
            </div>
          ) : null}
        </section>

        {labMode ? (
          <aside className="lab-panel">
            <div className="lab-heading">
              <FlaskConical size={18} />
              <div>
                <strong>识别实验室</strong>
                <span>仅在 ?lab=1 显示</span>
              </div>
            </div>
            <div className="lab-actions">
              <button type="button" onClick={() => app.loadSample()}>加载测试案例</button>
              <button type="button" onClick={app.downloadJson} disabled={!app.result}>导出 JSON</button>
            </div>
            <div className="sample-case-grid" aria-label="多图片测试案例">
              {app.sampleCases.map((sampleCase) => (
                <button
                  key={sampleCase.id}
                  type="button"
                  onClick={() => app.loadSample(sampleCase.id)}
                >
                  {sampleCase.name}
                </button>
              ))}
            </div>
            {app.result && app.summary ? (
              <>
                <ResultSummary
                  benchmark={app.benchmark}
                  developerMode
                  result={app.result}
                  reviewCount={app.verificationQueue.length}
                  summary={app.summary}
                />
                <ModelRunHistory
                  isBenchmarking={app.isBenchmarking}
                  progress={app.benchmarkProgress}
                  runs={app.modelRuns}
                  onRunModelSuite={app.runModelBenchmarkSuite}
                />
                <UxScorePanel paperTemplate={app.activePaperTemplate} result={app.result} />
              </>
            ) : null}
          </aside>
        ) : null}
      </div>
    </main>
  )
}

export default App
