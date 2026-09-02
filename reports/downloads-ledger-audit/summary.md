# Downloads Ledger Grid-Cut Audit

This report is generated locally. It uses Apple Vision readout through `scripts/vision-ocr.swift` only to triage page completeness and does not call any model API.

## Summary

- Total images: 31
- Local readout complete 1-31 date rows: 13
- Local readout incomplete or risky: 18
- Portrait: 26
- Landscape: 5

## Buckets

| bucket | count |
| --- | ---: |
| complete-page-candidate | 13 |
| incomplete-or-cropped | 9 |
| review-before-model | 9 |

## Images

| file | size | ocr dates | missing | bucket | sha256 |
| --- | --- | ---: | --- | --- | --- |
| 1692330cc1b52ac5f9fe33ed58140623.jpg | 3072x4096 | 13-31 (19) | 1,2,3,4,5,6,7,8... | incomplete-or-cropped | 928e28140e6af10f |
| 1c4e8a1a1727952e4b90b1a61e465ed8.jpg | 3072x4096 | 10-31 (22) | 1,2,3,4,5,6,7,8... | incomplete-or-cropped | 360928a35cb3b4f5 |
| 1e54d27dad3fbca7d52c62b825ef3a71.jpg | 3072x4096 | 1-31 (31) |  | complete-page-candidate | c4d55af0d17b613d |
| 1f31da0cafe43b683d93d72cb62f0df6.jpg | 3072x4096 | 1-31 (30) | 9 | review-before-model | 46ae16daa6affd34 |
| 209da0c831338ad89b2225589b8509c2.jpg | 3072x4096 | 1-31 (31) |  | complete-page-candidate | 830a3199658718cf |
| 2100752e0bd5becaee8df0d511d8b4b8.jpg | 4096x3072 | 1-31 (27) | 5,6,8,23 | review-before-model | add5f305a42472f7 |
| 265d8c382dbff5d038ee586058d05487.jpg | 3072x4096 | 1-31 (31) |  | complete-page-candidate | f0e50058c051f751 |
| 283b5293967076b0a27fcc73eaf664be.jpg | 3072x4096 | 4-31 (28) | 1,2,3 | review-before-model | f168c99f5a21dc58 |
| 28db2a49bf5a33076ff3a5dff15c01e5.jpg | 3072x4096 | 1-31 (31) |  | complete-page-candidate | 9537a1d50c52ad59 |
| 2e0f3c7f440a7b3e12bf659e0956b0f4.jpg | 3072x4096 | 1-31 (31) |  | complete-page-candidate | d0e7e64856545b80 |
| 319817e2b341941a842f087f6fd2604e.jpg | 4096x3072 | 4-31 (28) | 1,2,3 | review-before-model | b929743cd60c9209 |
| 41968dfef3ad304fec11cd541c322a42.jpg | 3072x4096 | 1-31 (31) |  | complete-page-candidate | 487d6e3842902955 |
| 43d839acd4af0e6b7bd71b39f4efc861.jpg | 3072x4096 | 1-31 (30) | 6 | review-before-model | d7a9217377d4a7c4 |
| 4692731ea3e39a6002303e488bf3f6da.jpg | 3072x4096 | 1-31 (31) |  | complete-page-candidate | cce6f2d55c3aead0 |
| 4dfd4360c1cd1b2180dcce57d811ad97.jpg | 3072x4096 | 1-31 (31) |  | complete-page-candidate | 954433d7ec500242 |
| 4eaf23ad8455a5179773dc967e163aeb.jpg | 3072x4096 | 1-31 (31) |  | complete-page-candidate | 92e4716f599582b4 |
| 522e50a3347e6c6381a281d5290de60f.jpg | 3072x4096 | 6-31 (25) | 1,2,3,4,5,10 | incomplete-or-cropped | 95da7e4ada030d71 |
| 60a37979fe54349f8d4eba53765d3527.jpg | 3072x4096 | 1-31 (31) |  | complete-page-candidate | a6816ad6cd9552be |
| 691113c29a125f48d14fb6631672dabd.jpg | 3072x4096 | 1-31 (30) | 9 | review-before-model | af73c39a6c114371 |
| 7805a916191c6c7213ed8d32b97fef6c.jpg | 3072x4096 | 1-31 (31) |  | complete-page-candidate | be0d9d634fb4bf42 |
| 7c45361f3d8de022d85a6516c6d6fecb.jpg | 3072x4096 | 1-31 (31) |  | complete-page-candidate | 5fcf944353ab330d |
| 92847c57cf0b6252765abafa5292fcf3.jpg | 4096x3072 | 1-31 (25) | 3,4,5,8,12,16 | incomplete-or-cropped | 817628308f7f85ee |
| ab4e3305ff4fb2b1dd0c1da885ccc6c1.jpg | 3072x4096 | 1-31 (30) | 8 | review-before-model | a4315b62d72fc7a5 |
| bae41cc17daa6c93e776597ed04ba22c.jpg | 3072x4096 | 1-31 (31) |  | complete-page-candidate | 74709fa1287d8c58 |
| bfb7eefe5d906e163505509e3bb61236.jpg | 3072x4096 | 4-31 (24) | 1,2,3,5,6,8,10 | incomplete-or-cropped | 22cf873276a30b34 |
| d4b02f90d17f67a29d7ca3c21865cb53.jpg | 4096x3072 | 1-31 (26) | 4,5,6,12,13 | incomplete-or-cropped | a0522b2ab5eb388c |
| db04ad665c76a081d3f1f83ac183a712.jpg | 3072x4096 | 1-31 (29) | 2,3 | review-before-model | c8248a2624ccc5f6 |
| f709270169f42a987a5c87a7379b8b57.jpg | 3072x4096 | 1-31 (26) | 22,23,24,25,28 | incomplete-or-cropped | e07f4b9c39456956 |
| f70cdaafc423f16ce1400746a6392cca.jpg | 4096x3072 | 7-31 (24) | 1,2,3,4,5,6,9 | incomplete-or-cropped | 19fb9848c69be7a5 |
| f79c2a51443157c42e532fa3edfe5419.jpg | 3072x4096 | 1-27 (27) | 28,29,30,31 | review-before-model | 166bafaa00ff5680 |
| fc5d23fd791ddffacc863b89f9cc4f4b.jpg | 3072x4096 | 1-31 (26) | 10,11,12,14,15 | incomplete-or-cropped | c3920cea6a67788a |

