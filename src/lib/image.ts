export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error))
    reader.readAsDataURL(file)
  })
}

export async function urlToDataUrl(url: string) {
  const response = await fetch(url)
  const blob = await response.blob()
  return fileToDataUrl(new File([blob], 'sample.png', { type: blob.type }))
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => reject(new Error('图片加载失败。')))
    image.src = dataUrl
  })
}

function isRedInk(red: number, green: number, blue: number) {
  const dominance = red - Math.max(green, blue)
  const saturation = red - Math.min(green, blue)
  return red > 92 && dominance > 18 && saturation > 30 && red > green * 1.08 && red > blue * 1.18
}

function hasRedNeighbor(mask: Uint8Array, width: number, height: number, x: number, y: number) {
  for (let dy = -1; dy <= 1; dy += 1) {
    const yy = y + dy
    if (yy < 0 || yy >= height) continue
    for (let dx = -1; dx <= 1; dx += 1) {
      const xx = x + dx
      if (xx < 0 || xx >= width) continue
      if (mask[yy * width + xx]) return true
    }
  }
  return false
}

export async function preprocessImageForOcr(dataUrl: string) {
  const image = await loadImage(dataUrl)
  const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return dataUrl

  context.drawImage(image, 0, 0, width, height)
  const imageData = context.getImageData(0, 0, width, height)
  const data = imageData.data
  const redMask = new Uint8Array(width * height)

  for (let pixel = 0; pixel < redMask.length; pixel += 1) {
    const offset = pixel * 4
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    redMask[pixel] = isRedInk(red, green, blue) ? 1 : 0
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x
      const offset = pixel * 4
      if (!hasRedNeighbor(redMask, width, height, x, y)) continue
      const paper = Math.max(238, Math.min(255, Math.round((data[offset + 1] + data[offset + 2]) / 2) + 22))
      data[offset] = paper
      data[offset + 1] = paper
      data[offset + 2] = paper
    }
  }

  context.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/webp', 0.78)
}

export async function cropImageRegion(
  dataUrl: string,
  region: { x: number; y: number; width: number; height: number },
  paddingRatio = 0.16,
) {
  const image = await loadImage(dataUrl)
  const padX = region.width * paddingRatio
  const padY = region.height * paddingRatio
  const left = Math.max(0, region.x - padX)
  const top = Math.max(0, region.y - padY)
  const right = Math.min(100, region.x + region.width + padX)
  const bottom = Math.min(100, region.y + region.height + padY)

  const pixelLeft = Math.max(0, Math.floor((left / 100) * image.naturalWidth))
  const pixelTop = Math.max(0, Math.floor((top / 100) * image.naturalHeight))
  const pixelWidth = Math.max(1, Math.ceil(((right - left) / 100) * image.naturalWidth))
  const pixelHeight = Math.max(1, Math.ceil(((bottom - top) / 100) * image.naturalHeight))
  const scale = Math.min(3, Math.max(1.5, 360 / Math.max(pixelWidth, pixelHeight)))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(pixelWidth * scale))
  canvas.height = Math.max(1, Math.round(pixelHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) return dataUrl

  context.imageSmoothingEnabled = false
  context.drawImage(
    image,
    pixelLeft,
    pixelTop,
    pixelWidth,
    pixelHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return canvas.toDataURL('image/jpeg', 0.92)
}
