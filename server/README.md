# tong ledger server starter

This is a dependency-light Node server starter for deployable OCR routes. It does not replace the frontend local grid cutter; it handles server-side OCR and preflight contracts.

## Run

```bash
pnpm server:dev
```

Health check:

```bash
curl http://127.0.0.1:8788/api/health
```

## Cell handwriting OCR

`POST /api/recognize/cells`

Use this for high-risk cell crops after the frontend has cut the ledger grid. It is deliberately cell-level: it should read handwritten digits, X/marks, blanks, or red calculation text, but it must not compute the full ledger total.

Request:

```json
{
  "cells": [
    {
      "cellId": "r9-paper-2",
      "cropRef": "cell:r9-paper-2",
      "cropImageDataUrl": "data:image/jpeg;base64,...",
      "row": 9,
      "columnLabel": "纸类2",
      "columnKind": "product"
    }
  ]
}
```

Response:

```json
{
  "provider": "openai-compatible",
  "readings": [
    {
      "cellId": "r9-paper-2",
      "cropRef": "cell:r9-paper-2",
      "text": "570",
      "candidates": ["570", "510"],
      "kind": "number",
      "confidence": 0.86,
      "note": "single-cell handwriting"
    }
  ]
}
```

Environment variables:

```bash
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
CELL_OCR_MODEL=gpt-4o-mini
```

If no API key is configured, the route returns mock uncertain readings. That is useful for deployment smoke tests, not production recognition.

## Date preflight

`POST /api/date-preflight`

The frontend already calls this contract when date preflight is enabled. This starter returns `501` until a server OCR provider is wired in. Production can implement it with PaddleOCR, RapidOCR, Tesseract, a private OCR service, or a narrow date-column model.

Only `status: "complete"` allows full-page OCR to continue. `review` and `incomplete` hold the image for local review.

## Red handwritten calculations

The ledger examples include red manual calculations such as multiplication lines, underlines, and already-computed totals. Treat them as audit evidence:

- Do not count red calculation totals as ordinary grid-cell numbers.
- Preserve them as `kind: "text"` or audit notes.
- Use them to detect conflicts between grid-cell recomputation and the human-written total.
- Lower confidence when red calculations and reconstructed cell totals disagree.
