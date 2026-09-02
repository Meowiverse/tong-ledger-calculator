export interface PageCompletenessModelData {
  version: string
  featureNames: string[]
  means: number[]
  scales: number[]
  weights: number[]
  bias: number
  completeThreshold: number
}

export const PAGE_COMPLETENESS_MODEL: PageCompletenessModelData = {
  "version": "page-completeness-logreg-v1-downloads-20260626",
  "featureNames": [
    "gridScore",
    "gridConfidence",
    "rawHorizontalCoverage",
    "rawVerticalCoverage",
    "rawHorizontalSpanNorm",
    "rawVerticalSpanNorm",
    "alignedHorizontalMatchNorm",
    "alignedHorizontalSyntheticNorm",
    "alignedVerticalMatchNorm",
    "alignedVerticalSyntheticNorm",
    "effectiveHorizontalCoverage",
    "effectiveVerticalCoverage",
    "fallbackX",
    "fallbackY",
    "meanCutConfidence",
    "lowCutRatio",
    "ocrCriticalLowCutRatio",
    "reviewRatio",
    "calibrateRatio"
  ],
  "means": [
    0.351613,
    0.351613,
    0.408602,
    0.464516,
    0.535303,
    0.514274,
    0.373412,
    0.532747,
    0.270968,
    0.641935,
    0.529129,
    0.701935,
    0.741935,
    0.774194,
    0.596452,
    0.301355,
    0.291355,
    0.698677,
    0.301323
  ],
  "scales": [
    0.163097,
    0.163097,
    0.22399,
    0.443991,
    0.297413,
    0.366892,
    0.205725,
    0.245191,
    0.205086,
    0.288236,
    0.266377,
    0.219169,
    0.43757,
    0.418112,
    0.14116,
    0.415554,
    0.4141,
    0.415574,
    0.415574
  ],
  "weights": [
    -0.625736,
    -0.625736,
    -1.716411,
    -3.146872,
    0.462801,
    0.533192,
    0.341148,
    0.066035,
    1.311782,
    -0.674252,
    -0.95791,
    -2.420088,
    -0.043863,
    0.939895,
    2.282423,
    -0.164285,
    -0.74045,
    0.169701,
    -0.169701
  ],
  "bias": -0.847477,
  "completeThreshold": 0.69
}
