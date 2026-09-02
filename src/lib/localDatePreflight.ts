export interface LocalDatePreflightReport {
  status: 'complete' | 'review' | 'incomplete'
  dateCount: number
  dateRange: string
  datesPresent: number[]
  datesMissing: number[]
  note: string
}

export function shouldHoldForLocalDatePreflight(report: LocalDatePreflightReport | null) {
  if (!report) return false
  return report.status !== 'complete'
}

export async function runLocalDatePreflight({
  imageDataUrl,
  endpoint,
}: {
  imageDataUrl: string
  endpoint: string
}): Promise<LocalDatePreflightReport> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 12_000)
  let response: Response
  try {
    response = await fetch(endpoint.trim() || '/api/date-preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('日期预审超过 12 秒未返回。', { cause: error })
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `日期预审接口失败: ${response.status}`)
  }

  const payload = (await response.json()) as Partial<LocalDatePreflightReport>
  const datesPresent = Array.isArray(payload.datesPresent)
    ? payload.datesPresent.filter((day): day is number => Number.isInteger(day))
    : []
  const datesMissing = Array.isArray(payload.datesMissing)
    ? payload.datesMissing.filter((day): day is number => Number.isInteger(day))
    : []
  const status =
    payload.status === 'complete' || payload.status === 'review' || payload.status === 'incomplete'
      ? payload.status
      : datesPresent.length === 31 && datesMissing.length === 0
        ? 'complete'
        : datesPresent.length >= 27
          ? 'review'
          : 'incomplete'

  return {
    status,
    dateCount: typeof payload.dateCount === 'number' ? payload.dateCount : datesPresent.length,
    dateRange: typeof payload.dateRange === 'string' ? payload.dateRange : 'none',
    datesPresent,
    datesMissing,
    note:
      typeof payload.note === 'string' && payload.note.trim()
        ? payload.note
        : status === 'complete'
          ? '日期预审接口确认 1-31 齐全。'
          : '日期预审接口发现日期不完整，先进入人工复核。',
  }
}
