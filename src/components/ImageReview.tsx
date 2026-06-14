import { useState } from 'react'
import { Crosshair, ZoomIn } from 'lucide-react'
import { getAnchorPosition } from '../lib/anchors'
import { getCuttingFeasibility } from '../lib/ledgerCells'
import type { ImageRegion, PaperTemplate, RecognitionResult } from '../types'
import './ImageReview.css'

interface ImageReviewProps {
  imageUrl: string
  currentNumber: number
  paperTemplate: PaperTemplate
  result: RecognitionResult
  selectedEntryId: string
}

function regionStyle(region: ImageRegion) {
  return {
    left: `${region.x}%`,
    top: `${region.y}%`,
    width: `${region.width}%`,
    height: `${region.height}%`,
  }
}

function regionCenter(region: ImageRegion) {
  return {
    x: region.x + region.width / 2,
    y: region.y + region.height / 2,
  }
}

function formatResidual(value: number | null) {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : '证据不足'
}

function growRegion(region: ImageRegion, paddingRatio = 0.18): ImageRegion {
  const padX = region.width * paddingRatio
  const padY = region.height * paddingRatio
  const x = Math.max(0, region.x - padX)
  const y = Math.max(0, region.y - padY)
  return {
    x,
    y,
    width: Math.min(100 - x, region.width + padX * 2),
    height: Math.min(100 - y, region.height + padY * 2),
  }
}

function CellCutout({ imageRatio, imageUrl, region }: {
  imageRatio: number
  imageUrl: string
  region: ImageRegion
}) {
  const crop = growRegion(region)

  return (
    <div
      className="source-cell-cutout"
      aria-label="当前格子裁剪"
      style={{ aspectRatio: `${crop.width} / ${crop.height * imageRatio}` }}
    >
      <img
        src={imageUrl}
        alt=""
        aria-hidden="true"
        style={{
          width: `${(100 / crop.width) * 100}%`,
          left: `${-(crop.x / crop.width) * 100}%`,
          top: `${-(crop.y / crop.height) * 100}%`,
        }}
      />
      <span aria-hidden="true" />
    </div>
  )
}

export function ImageReview({
  imageUrl,
  currentNumber,
  paperTemplate,
  result,
  selectedEntryId,
}: ImageReviewProps) {
  const [imageRatio, setImageRatio] = useState(4 / 3)
  const [zoom, setZoom] = useState(4.8)
  const selectedEntry = result.entries.find((entry) => entry.id === selectedEntryId)
  const selectedMark = result.uncertainMarks.find((mark) => mark.id === selectedEntryId)
  const nearbyEntry = selectedMark
    ? result.entries.find(
        (entry) =>
          Math.abs(entry.region.x - selectedMark.region.x) < 1 &&
          Math.abs(entry.region.y - selectedMark.region.y) < 1,
      )
    : undefined
  const selectedCell = result.cells?.find(
    (cell) =>
      cell.id === selectedEntryId ||
      cell.entryIds.includes(selectedEntryId) ||
      Boolean(selectedEntry && cell.entryIds.includes(selectedEntry.id)) ||
      Boolean(nearbyEntry && cell.entryIds.includes(nearbyEntry.id)),
  )
  const selectedRegion = selectedCell?.bboxOriginal ?? selectedEntry?.region ?? selectedMark?.region
  const tokenRegion = selectedEntry?.region ?? selectedMark?.region
  const cutting = getCuttingFeasibility(result, paperTemplate)
  const selectedAnchor = selectedEntry?.anchor ?? selectedMark?.anchor
  const selectedPosition = selectedRegion
    ? regionCenter(selectedRegion)
    : tokenRegion
      ? getAnchorPosition(selectedAnchor, tokenRegion)
      : null
  const locationLabel =
    selectedEntry?.label ??
    nearbyEntry?.label ??
    (selectedCell ? `${selectedCell.row}日${selectedCell.columnLabel}` : '图片中的待核对位置')
  const targetText =
    selectedMark?.text ?? selectedEntry?.rawText ?? nearbyEntry?.rawText ?? selectedCell?.rawText ?? ''

  if (!selectedPosition || !selectedRegion) return null

  return (
    <section className="image-review">
      <div className="review-intro">
        <Crosshair size={19} />
        <div>
          <strong>{locationLabel} · 当前第 {currentNumber} 处</strong>
          <span>
            自动切割 {cutting.score} 分 · {cutting.label} · {cutting.support.distinctRows} 行/
            {cutting.support.distinctColumns} 列证据
          </span>
        </div>
      </div>

      <div className={`cutting-feasibility is-${cutting.level}`} aria-label="自动切割可行度">
        <span>固定模板</span>
        <strong>vs</strong>
        <span>识别校准</span>
        <b>{cutting.label}</b>
        <em>
          偏差 {cutting.maxDelta.toFixed(1)}% · 残差 {formatResidual(cutting.residuals.max)} · 证据
          {cutting.support.rowPoints}/{cutting.support.columnPoints}
          {cutting.fallback.x || cutting.fallback.y ? ' · 已回退模板' : ''}
        </em>
      </div>

      <div className="source-grid-stage" aria-label="原图固定格子切割对照">
        <div className="source-image-frame">
          <img
            src={imageUrl}
            alt=""
            aria-hidden="true"
            onLoad={(event) => {
              const image = event.currentTarget
              if (image.naturalWidth) setImageRatio(image.naturalHeight / image.naturalWidth)
            }}
          />
          <span
            className="source-template-frame"
            aria-hidden="true"
            style={regionStyle(cutting.fixedRegion)}
          />
          <span
            className="source-table-frame"
            aria-hidden="true"
            style={regionStyle(cutting.calibratedRegion)}
          />
          <span
            className="source-cell-frame"
            aria-hidden="true"
            style={regionStyle(selectedRegion)}
          />
          {tokenRegion ? (
          <span
            className="source-token-frame"
            aria-hidden="true"
            style={regionStyle(tokenRegion)}
          />
          ) : null}
          <b>{selectedCell?.id ?? selectedEntryId}</b>
        </div>
      </div>

      {selectedRegion ? (
        <CellCutout imageRatio={imageRatio} imageUrl={imageUrl} region={selectedRegion} />
      ) : null}

      <div
        className="magnifier-stage"
        role="group"
        aria-label="当前待核对数字的放大镜"
      >
        <img
          className="magnifier-context"
          src={imageUrl}
          alt=""
          aria-hidden="true"
          onLoad={(event) => {
            const image = event.currentTarget
            if (image.naturalWidth) setImageRatio(image.naturalHeight / image.naturalWidth)
          }}
          style={{
            left: `${50 - selectedPosition.x * 1.8}%`,
            top: `calc(50% - ${selectedPosition.y * 1.8 * imageRatio}cqw)`,
          }}
        />
        <button
          className="magnifier-lens"
          type="button"
          aria-label={`当前放大 ${zoom} 倍，点击切换倍率`}
          onClick={() => setZoom((value) => (value === 4.8 ? 6.2 : 4.8))}
        >
          <img
            src={imageUrl}
            alt=""
            aria-hidden="true"
            style={{
              width: `${zoom * 100}cqw`,
              left: `calc(50% - ${selectedPosition.x * zoom}cqw)`,
              top: `calc(50% - ${selectedPosition.y * zoom * imageRatio}cqw)`,
            }}
          />
          <span
            className="focus-target"
            aria-hidden="true"
            style={{
              width: `clamp(44px, ${(selectedRegion?.width ?? 4) * zoom}cqw, 96px)`,
              height: `clamp(30px, ${(selectedRegion?.height ?? 2) * zoom * imageRatio}cqw, 72px)`,
            }}
          >
            <span className="focus-corners" />
            <span className="focus-center" />
          </span>
          <span className="lens-label">目标 {targetText || currentNumber}</span>
          <span className="lens-zoom">{zoom}×</span>
        </button>
        <span className="magnifier-handle" aria-hidden="true" />
      </div>

      <button
        className="magnifier-control"
        type="button"
        onClick={() => setZoom((value) => (value === 4.8 ? 6.2 : 4.8))}
      >
        <ZoomIn size={17} />
        点击放大镜切换倍率
        <strong>{zoom}×</strong>
      </button>
    </section>
  )
}
