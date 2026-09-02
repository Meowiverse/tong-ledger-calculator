# Downloads Gridcut Readiness Summary

Generated from:

- `reports/downloads-ledger-audit/manifest.json`
- `reports/gridcut-benchmark/downloads-readiness-20260626.json`

## Current state

- Total images audited: 31
- Local date-complete page candidates: 13
- Local gridcut `modelReadyRate`: 0.323
- Local gridcut `strictOneTapReadyRate`: 0
- Local gridcut mean score: 35.16
- Local low-confidence cut ratio: 0.301

## What this means

- Out of the 31 Downloads images, 10 pages now reach `send-with-review`.
- The other 21 pages should still be held before OCR token spend.
- This is still mainly a local gridcut problem rather than an OCR problem.
- The current preflight is now stricter but better aligned with the real cell-level cut evidence instead of only using page score.
- The latest improvements came from five changes:
  - preventing narrow line spans from shrinking the whole table region,
  - giving more weight to template-completed cells whose four edges still match the recovered grid,
  - using OCR-critical column stability so the attendance column no longer dominates the whole-page gate,
  - pulling sparse detected lines closer to the fixed ledger template when the evidence is weak but still orderly,
  - and recognizing template-projected pages that still have enough real support on both axes to justify `send-with-review`.

## Main failure pattern

Most failed pages show one or more of:

- vertical line evidence too weak
- horizontal line coverage too low
- overall line spacing residual too high
- outer detected region too far from the fixed template

## Worst complete-page candidates

These pages already look complete by local date audit, but gridcut still fails badly:

- `4692731ea3e39a6002303e488bf3f6da.jpg` - score 12, lowCutRatio 1
- `4dfd4360c1cd1b2180dcce57d811ad97.jpg` - score 20, lowCutRatio 1
- `7c45361f3d8de022d85a6516c6d6fecb.jpg` - score 23, lowCutRatio 1

These three are the real remaining hard set among the complete-page candidates. They are not just slightly under threshold:

- `7c453...` still has only 1 detected vertical line even though horizontal evidence is abundant.
- `4dfd...` also still has only 1 detected vertical line and remains far from reviewable.
- `469273...` still lacks enough real support on both axes, so the page stays correctly held.

## Currently usable pages

- `1e54d27dad3fbca7d52c62b825ef3a71.jpg`
  - score 49
  - lowCutRatio 0.005
  - OCR-critical lowCutRatio 0.005
  - meanCutConfidence 0.66
  - 216 review-level cells / 1 calibrate-level cell
  - current gate: `send-with-review`
  - notable change: this page was previously held because the middle product columns carried a stable but too-large template drift

- `209da0c831338ad89b2225589b8509c2.jpg`
  - score 50
  - lowCutRatio 0
  - OCR-critical lowCutRatio 0
  - meanCutConfidence 0.69
  - 217 review-level cells / 0 calibrate-level cells
  - current gate: `send-with-review`

- `265d8c382dbff5d038ee586058d05487.jpg`
  - score 47
  - lowCutRatio 0
  - OCR-critical lowCutRatio 0
  - meanCutConfidence 0.76
  - 217 review-level cells / 0 calibrate-level cells
  - current gate: `send-with-review`

- `28db2a49bf5a33076ff3a5dff15c01e5.jpg`
  - score 18
  - lowCutRatio 0.194
  - OCR-critical lowCutRatio 0.194
  - meanCutConfidence 0.6
  - 175 review-level cells / 42 calibrate-level cells
  - current gate: `send-with-review`
  - notable change: this page is now rescued by the new template-projection path and should be treated as high-review-intensity rather than blocked

- `2e0f3c7f440a7b3e12bf659e0956b0f4.jpg`
  - score 49
  - lowCutRatio 0
  - OCR-critical lowCutRatio 0
  - meanCutConfidence 0.69
  - 217 review-level cells / 0 calibrate-level cells
  - current gate: `send-with-review`

- `41968dfef3ad304fec11cd541c322a42.jpg`
  - score 18
  - lowCutRatio 0.258
  - OCR-critical lowCutRatio 0.258
  - meanCutConfidence 0.58
  - 161 review-level cells / 56 calibrate-level cells
  - current gate: `send-with-review`
  - notable change: this page is also rescued by the template-projection path and should be treated as high-review-intensity rather than blocked

- `4eaf23ad8455a5179773dc967e163aeb.jpg`
  - score 29
  - lowCutRatio 0.041
  - OCR-critical lowCutRatio 0
  - meanCutConfidence 0.65
  - 208 review-level cells / 9 calibrate-level cells
  - current gate: `send-with-review`

- `60a37979fe54349f8d4eba53765d3527.jpg`
  - score 50
  - lowCutRatio 0
  - OCR-critical lowCutRatio 0
  - meanCutConfidence 0.73
  - 217 review-level cells / 0 calibrate-level cells
  - current gate: `send-with-review`

- `7805a916191c6c7213ed8d32b97fef6c.jpg`
  - score 43
  - lowCutRatio 0.065
  - OCR-critical lowCutRatio 0
  - meanCutConfidence 0.62
  - 203 review-level cells / 14 calibrate-level cells
  - current gate: `send-with-review`

- `bae41cc17daa6c93e776597ed04ba22c.jpg`
  - score 50
  - lowCutRatio 0
  - OCR-critical lowCutRatio 0
  - meanCutConfidence 0.72
  - 217 review-level cells / 0 calibrate-level cells
  - current gate: `send-with-review`

## Product implication

Right now the app is safer and smarter than before:

- it no longer relies only on page score,
- it uses local cell-level cut readiness before allowing OCR,
- it now distinguishes normal review from strong review so the user sees when to prioritize cut-risk cells first,
- and it can now rescue ten real complete-page photos into `send-with-review`.

But the real completion bar has still not been reached. To get close to one-click success on the user's actual photos, the next work should keep strengthening the local grid segmentation itself, especially on the remaining complete pages that still fail because the local detector sees too few true vertical lines.
