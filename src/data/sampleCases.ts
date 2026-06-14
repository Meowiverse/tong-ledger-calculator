import { SAMPLE_RECOGNITION } from './sampleRecognition'
import type { RecognitionResult } from '../types'

export interface SampleCase {
  id: string
  name: string
  imageUrl: string
  expectedResult: RecognitionResult
}

export const SAMPLE_CASES: SampleCase[] = [
  {
    id: 'ledger-original',
    name: '原图样例',
    imageUrl: 'samples/handwritten-ledger.png',
    expectedResult: SAMPLE_RECOGNITION,
  },
  {
    id: 'ledger-phone',
    name: '手机拍照样例',
    imageUrl: 'samples/handwritten-ledger-phone.png',
    expectedResult: SAMPLE_RECOGNITION,
  },
  {
    id: 'ledger-rescan',
    name: '复扫样例',
    imageUrl: 'samples/handwritten-ledger-rescan.png',
    expectedResult: SAMPLE_RECOGNITION,
  },
]

export const DEFAULT_SAMPLE_CASE = SAMPLE_CASES[0]

export function findSampleCaseByImageUrl(imageUrl: string) {
  return SAMPLE_CASES.find((sampleCase) => sampleCase.imageUrl === imageUrl) ?? null
}

export function findSampleCaseById(sampleCaseId: string) {
  return SAMPLE_CASES.find((sampleCase) => sampleCase.id === sampleCaseId) ?? DEFAULT_SAMPLE_CASE
}
