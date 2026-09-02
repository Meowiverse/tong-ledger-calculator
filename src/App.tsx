import { ChevronDown, FlaskConical } from 'lucide-react'
import './App.css'
import './Responsive.css'
import { ActionBar } from './components/ActionBar'
import { BrandHeader } from './components/BrandHeader'
import { CropOcrPlanPanel } from './components/CropOcrPlanPanel'
import { EntryTable } from './components/EntryTable'
import { HeroCapture } from './components/HeroCapture'
import { ImageReview } from './components/ImageReview'
import { ModelRunHistory } from './components/ModelRunHistory'
import { PreflightPanel } from './components/PreflightPanel'
import { ReconstructedLedgerTable } from './components/ReconstructedLedgerTable'
import { ResultSummary } from './components/ResultSummary'
import { SettingsPanel } from './components/SettingsPanel'
import { UxScorePanel } from './components/UxScorePanel'
import { VerificationCard } from './components/VerificationCard'
import { useLedgerApp } from './hooks/useLedgerApp'
import { formatAmount } from './lib/calculation'
import { isHostedOneTapMode } from './lib/hostedMode'

function App() {
  const app = useLedgerApp()
  const hostedOneTapMode = isHostedOneTapMode()
  const labMode = !hostedOneTapMode && new URLSearchParams(window.location.search).get('lab') === '1'
  const oneTapMode = hostedOneTapMode
  const hasImage = Boolean(app.imageUrl)
  const hasResult = Boolean(app.result && app.summary)

  return (
    <main className="app-shell">
      <div className="phone-frame">
        <section className="main-flow">
          <BrandHeader
            onToggleSettings={
              oneTapMode ? undefined : () => app.setShowSettings((value) => !value)
            }
          />

          {app.showSettings && !oneTapMode ? (
            <SettingsPanel
              activePaperTemplate={app.activePaperTemplate}
              apiSelfCheck={app.apiSelfCheck}
              isCheckingApi={app.isCheckingApi}
              prompt={app.prompt}
              settings={app.settings}
              onAddPrompt={app.addPrompt}
              onCheckApi={app.checkApiReadiness}
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
              oneTapMode={oneTapMode}
              prompt={app.prompt}
              settings={app.settings}
              onFile={app.handleFile}
              onUpdateSettings={app.updateSettings}
            />
          ) : null}

          {!hasResult && !oneTapMode ? (
            <PreflightPanel
              gridCut={app.preflightGridCut}
              isRunning={app.isPreflighting}
              readiness={app.preflightReadiness}
              shouldHold={app.shouldHoldForRecognition}
            />
          ) : null}

          {!hasResult ? (
            <ActionBar
              hasImage={hasImage}
              isRecognizing={app.isRecognizing}
              oneTapMode={oneTapMode}
              recognitionElapsedSeconds={app.recognitionElapsedSeconds}
              recognitionStage={app.recognitionStage}
              onPreviewCutting={app.previewLocalCutting}
              onRunRecognition={() => app.runRecognition(oneTapMode)}
            />
          ) : null}

          {app.error ? <div className="error-box" role="alert">{app.error}</div> : null}

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

          {hasResult && app.cropOcrPlan && !oneTapMode ? (
            <CropOcrPlanPanel
              compact={Boolean(app.activeVerificationItem)}
              execution={app.result?.cropOcrExecution}
              plan={app.cropOcrPlan}
            />
          ) : null}

          {hasResult && app.result && app.imageUrl ? (
            <section className="review-workspace">
              <ImageReview
                imageUrl={app.reviewImageUrl}
                currentNumber={Math.min(
                  app.verificationProgress.completed + 1,
                  app.verificationProgress.total,
                )}
                oneTapMode={oneTapMode}
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

          {hasResult ? (
            <div className="result-actions">
              {!oneTapMode &&
              app.result?.sourceType.includes('本地预览') &&
              app.canContinueFromPreview &&
              !app.isPreviewOverrideLocked ? (
                <button
                  className="primary-button"
                  type="button"
                  disabled={app.isRecognizing || app.isPreviewOverrideLocked}
                  onClick={() => app.continueRecognitionFromPreview()}
                >
                  {app.isRecognizing ? '正在送模型识别…' : '仍然送模型识别'}
                </button>
              ) : null}
              {app.isRecognizing ? (
                <div className="recognition-progress" role="status" aria-live="polite">
                  <div>
                    <span>{app.recognitionStage || '正在继续计算'}</span>
                    <strong>{app.recognitionElapsedSeconds}s</strong>
                  </div>
                  <p>
                    {app.recognitionElapsedSeconds >= 60
                      ? '服务器还在识别这张整页账本，请不要重复提交。'
                      : app.recognitionElapsedSeconds >= 25
                        ? '整页手写识别会比较慢，当前请求仍在进行。'
                        : '正在处理当前照片。'}
                  </p>
                  <i aria-hidden="true" />
                </div>
              ) : null}
              <HeroCapture
                compact
                hasImage
                imageUrl={app.reviewImageUrl}
                oneTapMode={oneTapMode}
                prompt={app.prompt}
                settings={app.settings}
                onFile={app.handleFile}
                onUpdateSettings={app.updateSettings}
              />
            </div>
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
                {app.cropOcrPlan ? (
                  <CropOcrPlanPanel
                    developerMode
                    execution={app.result?.cropOcrExecution}
                    plan={app.cropOcrPlan}
                  />
                ) : null}
                <ModelRunHistory
                  benchmarkMode={app.settings.qualityMode === 'max' ? 'high' : app.settings.qualityMode}
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
