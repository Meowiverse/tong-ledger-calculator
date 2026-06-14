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

## 开发

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

本项目使用 `@meowkj/fluent-emoji-assets` 统一渲染 Fluent Emoji 资源。

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
