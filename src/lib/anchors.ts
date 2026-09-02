import type { AnchorPoint, AnchorReference, ImageRegion } from '../types'

const ANCHOR_COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F']
const ANCHOR_ROWS = 10

interface AnchorAnnotationOptions {
  maxSize?: number
  quality?: number
}

export function buildAnchorGrid(): AnchorPoint[] {
  const anchors: AnchorPoint[] = []
  const minX = 10
  const maxX = 90
  const minY = 12
  const maxY = 92

  for (let row = 1; row <= ANCHOR_ROWS; row += 1) {
    for (let column = 0; column < ANCHOR_COLUMNS.length; column += 1) {
      anchors.push({
        id: `${ANCHOR_COLUMNS[column]}${row}`,
        x: minX + (column / (ANCHOR_COLUMNS.length - 1)) * (maxX - minX),
        y: minY + ((row - 1) / (ANCHOR_ROWS - 1)) * (maxY - minY),
      })
    }
  }

  return anchors
}

export const DEFAULT_ANCHORS = buildAnchorGrid()

export function getAnchorPosition(
  anchor: AnchorReference | null | undefined,
  fallbackRegion: ImageRegion,
  anchors = DEFAULT_ANCHORS,
) {
  const anchorRef = anchor ?? null
  const anchorPoint = anchorRef ? anchors.find((item) => item.id === anchorRef.anchorId) : null
  if (!anchorRef || !anchorPoint) {
    return {
      x: fallbackRegion.x + fallbackRegion.width / 2,
      y: fallbackRegion.y + fallbackRegion.height / 2,
    }
  }

  return {
    x: Math.max(0, Math.min(100, anchorPoint.x + anchorRef.offsetX)),
    y: Math.max(0, Math.min(100, anchorPoint.y + anchorRef.offsetY)),
  }
}

export async function annotateImageWithAnchors(
  imageDataUrl: string,
  anchors = DEFAULT_ANCHORS,
  options: AnchorAnnotationOptions = {},
): Promise<string> {
  const image = await loadImage(imageDataUrl)
  const canvas = document.createElement('canvas')
  const maxSize = options.maxSize ?? Math.max(image.naturalWidth, image.naturalHeight)
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight))
  canvas.width = Math.round(image.naturalWidth * scale)
  canvas.height = Math.round(image.naturalHeight * scale)

  const context = canvas.getContext('2d')
  if (!context) return imageDataUrl

  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  const fontSize = Math.max(16, Math.round(Math.min(canvas.width, canvas.height) * 0.018))
  const radius = Math.max(5, Math.round(Math.min(canvas.width, canvas.height) * 0.006))

  context.font = `700 ${fontSize}px system-ui, -apple-system, sans-serif`
  context.textBaseline = 'middle'

  for (const anchor of anchors) {
    const x = (anchor.x / 100) * canvas.width
    const y = (anchor.y / 100) * canvas.height
    const labelWidth = context.measureText(anchor.id).width

    context.fillStyle = 'rgba(255, 255, 255, 0.82)'
    roundRect(context, x + radius + 3, y - fontSize * 0.65, labelWidth + 9, fontSize * 1.3, 6)
    context.fill()

    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fillStyle = '#1d8fff'
    context.fill()
    context.lineWidth = 2
    context.strokeStyle = 'rgba(255, 255, 255, 0.95)'
    context.stroke()

    context.fillStyle = '#17466f'
    context.fillText(anchor.id, x + radius + 8, y)
  }

  return canvas.toDataURL('image/webp', options.quality ?? 0.82)
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => reject(new Error('Unable to load image for anchors.')))
    image.src = src
  })
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}
