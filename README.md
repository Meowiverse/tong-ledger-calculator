# tong账本计算器

手机优先的 BYOK 账本拍照计算 MVP。用户拍照或上传账单图片，选择本地保存的智能 prompt，通过多模态模型识别账单内容，并用彩色框显示 AI 评估的置信度。

## 功能

- 手机拍照入口：`capture="environment"` 优先拉起后置摄像头。
- BYOK：API Key、OpenAI 兼容接口地址、模型和 prompt 保存在当前浏览器的 `localStorage`，不会写入构建产物。
- 智能 prompt：内置手写账本、购物小票、AA 分摊三种模板，可编辑保存。
- 图片对照：AI 返回相对框选位置，UI 用绿色/黄色/红色表示置信度。
- 不确定字符：单独虚线框和候选字符提示。
- 示例模式：没有 API Key 时可加载内置手写账本测试图和示例识别结果。
- 自动测试：Vitest 覆盖账单合计和置信度分级。
- 固定格式：账本格式收敛为一种 31 日期行月账本，只允许配置纸类列与单价。
- 切割对照：自动校准表格区域后重建整张表，原图侧同步显示模板框、校准框、选中格子框和圆形放大镜。
- 日期预审接口：部署端可在送整页 OCR 前先确认 1-31 日期行，缺页或日期风险图默认停在本地复核，不先消耗云端 OCR token。
- 手写数字识别：服务器可对高风险单格裁剪图调用 `/api/recognize/cells`，返回候选值、类型和置信度；用户人工修正会沉淀成本地训练样本。

## 开发

```bash
pnpm install
pnpm dev
pnpm server:dev
pnpm test
pnpm build
pnpm benchmark:gridcut
pnpm test:e2e:mock
pnpm test:e2e:local-mock
```

本项目使用 `@meowkj/fluent-emoji-assets` 统一渲染 Fluent Emoji 资源。

## 本地切格基准

切格阶段完全本地运行，不会消耗 OCR token。可以先批量跑本地切格，再决定哪些图片值得进入 OCR。

```bash
pnpm build
pnpm benchmark:gridcut
pnpm benchmark:gridcut -- --dir="$HOME/Downloads"
pnpm benchmark:gridcut -- --dir="$HOME/Downloads" --manifest="reports/downloads-ledger-audit/manifest.json"
```

脚本会启动本地预览页，逐张走真实的“单页切割预览”流程，并把 `gridCut`、低置信格数量、回退情况写到
`reports/gridcut-benchmark/` 下的 JSON 报告里。

如果额外传入 `audit-download-images.mjs` 生成的 `manifest.json`，报告还会直接给出：

- `modelGate`: `hold` / `send-with-review` / `send`
- `modelReadyRate`: 当前这一批图里，有多少张值得直接进 OCR
- `strictOneTapReadyRate`: 当前这一批图里，有多少张已经接近“一键直跑”

## 服务器日期预审接口

纯切格模型只能判断格子位置是否能稳定切出来，不能可靠知道某个“9日”会不会被 OCR 漏读。为了让一键按钮更省 token、更保守，生产部署时建议在服务器实现一个日期预审接口：

`POST /api/date-preflight`

请求体：

```json
{ "imageDataUrl": "data:image/jpeg;base64,..." }
```

响应体：

```json
{
  "status": "complete",
  "dateCount": 31,
  "dateRange": "1-31",
  "datesPresent": [1, 2, 3],
  "datesMissing": [],
  "note": "日期 1-31 齐全"
}
```

`status` 只能是 `complete`、`review` 或 `incomplete`。只有 `complete` 会继续送整页 OCR；其他状态会先停在本地复核。这个接口可以用服务器上的轻量 OCR、PaddleOCR、Tesseract、私有视觉服务或其他内部实现，前端不绑定 macOS。

项目里保留了一个 Mac 开发/审计用 helper：

```bash
pnpm dev:date-preflight
```

它只是用来在开发机上复现实验结果，不是服务器部署方案。

可以用 Downloads 里的真实图片跑一键路由验收：

```bash
pnpm build
pnpm audit:one-tap -- --dir="$HOME/Downloads" --manifest="reports/downloads-ledger-audit/manifest.json" --local-date-preflight
```

当前这批 Downloads 样例在启用日期预审接口后，一键路由报告为 31/31 匹配，0 张误送模型。

## 手写数字识别与训练样本

手写数字识别属于 OCR 层，不属于切格模型层。推荐线上流程：

```text
前端切格子 -> 日期预审 -> 整页大模型识别 -> 高风险单格 /api/recognize/cells -> 人工复核
```

服务器 starter 在 `server/` 下，提供：

- `GET /api/health`
- `POST /api/date-preflight`
- `POST /api/recognize/cells`

`/api/recognize/cells` 可以接 OpenAI 兼容视觉模型，只读单格裁剪图，返回：

- `text`: 最可能值
- `candidates`: 候选值
- `kind`: `number` / `mark` / `blank` / `text` / `uncertain`
- `confidence`: 0-1 置信度
- `note`: 红字、压线、跨格等说明

Downloads 示例里有红色人工计算式和已经算好的红色合计。它们不是普通格子原始金额，不能重复入账；模型要把它们当作审计证据，用来发现漏项、倍率错误或总额冲突。

## 单次整页大模型烟测

如果只想验证“大模型单次整页识别”是否可用，可以只跑一张完整页候选图：

```bash
OPENAI_API_KEY=... pnpm smoke:whole-page-model -- --model=gpt-5.4
```

也可以换 OpenAI 兼容服务：

```bash
AUTOROUTER_API_KEY=... AUTOROUTER_BASE_URL=https://autorouter.io pnpm smoke:whole-page-model -- --model=gpt-5.5
```

脚本默认使用 `/Users/kongjing/Downloads/1e54d27dad3fbca7d52c62b825ef3a71.jpg`，只发一次整页请求，报告写入 `reports/model-smoke/`。单次整页结果只能证明该模型在这一张图上的表现；人工核查界面仍以本地切格坐标为准，模型返回的 `region` 只作为细蓝框参考。

用户在复核 UI 里修改格子时，前端会把该格裁剪图、最终标签、原始识别、切格置信度和风险标记保存到 `localStorage` 的 `tong-ledger-cell-training-samples-v1`。这些样本后续可以导出为专用手写数字模型训练集。

## 本地 mock 全链路

如果暂时不想消耗真实 OCR token，可以直接跑本地 mock 闭环测试：

```bash
pnpm test:e2e:mock
pnpm test:e2e:local-mock
```

它会在浏览器里真实点击上传、预检、整页识别、小图 OCR 复核，但把 `/v1/chat/completions` 用 Playwright mock 掉，
验证 `max` 模式下的整条前端链路是否能走通。

如果想直接在应用里演练而不是依赖 Playwright 拦截，可以把设置里的接口格式切到 `本地 mock（不消耗 token）`；
这会在前端直接返回内置样例数据，同样能跑通 `max`。

## GitHub Pages 静态部署

项目可以作为纯静态页面部署到 GitHub Pages。`vite.config.ts` 使用相对资源路径，支持部署在
`https://<user>.github.io/<repo>/` 这种仓库子路径下。

部署方式：

1. 推送到 GitHub 的 `main` 分支。
2. 在仓库 Settings -> Pages 中选择 GitHub Actions。
3. Actions 会执行 `pnpm lint`、`pnpm test:ui`、`pnpm test`、`pnpm build`，并发布 `dist`。

API Key 不需要也不应该放进 GitHub Secrets 或源码。用户打开页面后，在设置里填写自己的 API 地址和 Key，
这些信息只保存在当前浏览器本地。换设备、换浏览器或清理站点数据后需要重新填写。

默认接口模式为 OpenAI 兼容的 Chat Completions：

- API 地址可填 `https://api.openai.com/v1`，也可填兼容服务的 `/v1` 地址。
- 模型名由用户填写，例如 `gpt-4o`、`gemini-2.5-flash`、`qwen-vl-max` 等支持图片输入的模型。
- 程序会请求 `/v1/chat/completions`。如果兼容服务不支持 `response_format: json_object`，会自动去掉该字段重试一次。
- 如果使用 OpenAI Responses API，可在设置里把接口格式切换为 `Responses 接口`。

注意：浏览器本地保存 Key 适合个人自用和受信任设备。共享电脑、浏览器扩展、XSS 或第三方兼容接口仍可能读取
浏览器里的本地数据；如果要给多人生产使用，应改为后端代理保存 Key。
