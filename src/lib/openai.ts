import { annotateImageWithAnchors } from './anchors'
import { executeCalculationProgram, normalizeRecognitionResult } from './program'
import type {
  ApiMode,
  CalculationProgram,
  QualityMode,
  RecognitionResult,
  SmartPrompt,
  VisualExtractionResult,
} from '../types'

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com'

const recognitionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'sourceType',
    'summary',
    'currency',
    'overallConfidence',
    'computedTotal',
    'calculationFormula',
    'columnRules',
    'entries',
    'uncertainMarks',
    'extractedText',
    'auditNotes',
  ],
  properties: {
    title: { type: 'string' },
    sourceType: { type: 'string' },
    summary: { type: 'string' },
    currency: { type: 'string' },
    overallConfidence: { type: 'number', minimum: 0, maximum: 1 },
    computedTotal: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    calculationFormula: { type: 'string' },
    columnRules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'multiplier', 'evidenceText', 'confidence'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          multiplier: { type: 'number' },
          evidenceText: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'label',
          'rowLabel',
          'rawText',
          'normalizedText',
          'amount',
          'rawValue',
          'multiplier',
          'calculatedAmount',
          'formula',
          'category',
          'confidence',
          'region',
          'anchor',
          'note',
        ],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          rowLabel: { type: 'string' },
          rawText: { type: 'string' },
          normalizedText: { type: 'string' },
          amount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          rawValue: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          multiplier: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          calculatedAmount: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          formula: { type: 'string' },
          category: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          region: { $ref: '#/$defs/region' },
          anchor: { anyOf: [{ $ref: '#/$defs/anchor' }, { type: 'null' }] },
          note: { type: 'string' },
          cellId: { type: 'string' },
        },
      },
    },
    uncertainMarks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'reason', 'confidence', 'region', 'anchor', 'candidates'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          reason: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          region: { $ref: '#/$defs/region' },
          anchor: { anyOf: [{ $ref: '#/$defs/anchor' }, { type: 'null' }] },
          candidates: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    extractedText: { type: 'array', items: { type: 'string' } },
    auditNotes: { type: 'array', items: { type: 'string' } },
  },
  $defs: {
    region: {
      type: 'object',
      additionalProperties: false,
      required: ['x', 'y', 'width', 'height'],
      properties: {
        x: { type: 'number', minimum: 0, maximum: 100 },
        y: { type: 'number', minimum: 0, maximum: 100 },
        width: { type: 'number', minimum: 0, maximum: 100 },
        height: { type: 'number', minimum: 0, maximum: 100 },
      },
    },
    anchor: {
      type: 'object',
      additionalProperties: false,
      required: ['anchorId', 'offsetX', 'offsetY', 'note'],
      properties: {
        anchorId: { type: 'string' },
        offsetX: { type: 'number', minimum: -8, maximum: 8 },
        offsetY: { type: 'number', minimum: -8, maximum: 8 },
        note: { type: 'string' },
      },
    },
  },
} as const

const visualExtractionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'sourceType',
    'summary',
    'currency',
    'overallConfidence',
    'tokens',
    'extractedText',
    'auditNotes',
  ],
  properties: {
    title: { type: 'string' },
    sourceType: { type: 'string' },
    summary: { type: 'string' },
    currency: { type: 'string' },
    overallConfidence: { type: 'number', minimum: 0, maximum: 1 },
    tokens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'kind',
          'label',
          'rowLabel',
          'columnLabel',
          'rawText',
          'normalizedText',
          'numericValue',
          'candidates',
          'confidence',
          'region',
          'anchor',
          'note',
        ],
        properties: {
          id: { type: 'string' },
          kind: { enum: ['number', 'multiplier', 'mark', 'text'] },
          label: { type: 'string' },
          rowLabel: { type: 'string' },
          columnLabel: { type: 'string' },
          rawText: { type: 'string' },
          normalizedText: { type: 'string' },
          numericValue: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'confidence'],
              properties: {
                text: { type: 'string' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
              },
            },
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          region: { $ref: '#/$defs/region' },
          anchor: { anyOf: [{ $ref: '#/$defs/anchor' }, { type: 'null' }] },
          note: { type: 'string' },
        },
      },
    },
    extractedText: { type: 'array', items: { type: 'string' } },
    auditNotes: { type: 'array', items: { type: 'string' } },
  },
  $defs: recognitionSchema.$defs,
} as const

const calculationProgramSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'dslVersion',
    'title',
    'sourceType',
    'summary',
    'currency',
    'calculationFormula',
    'columnRules',
    'terms',
    'uncertainMarks',
    'extractedText',
    'auditNotes',
  ],
  properties: {
    dslVersion: { enum: ['tong-ledger-dsl/v1'] },
    title: { type: 'string' },
    sourceType: { type: 'string' },
    summary: { type: 'string' },
    currency: { type: 'string' },
    calculationFormula: { type: 'string' },
    columnRules: recognitionSchema.properties.columnRules,
    terms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'label',
          'rowLabel',
          'sourceTokenIds',
          'rawText',
          'normalizedText',
          'rawValue',
          'multiplier',
          'include',
          'category',
          'confidence',
          'formula',
          'note',
        ],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          rowLabel: { type: 'string' },
          sourceTokenIds: { type: 'array', items: { type: 'string' } },
          rawText: { type: 'string' },
          normalizedText: { type: 'string' },
          rawValue: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          multiplier: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          include: { type: 'boolean' },
          category: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          formula: { type: 'string' },
          note: { type: 'string' },
        },
      },
    },
    uncertainMarks: recognitionSchema.properties.uncertainMarks,
    extractedText: { type: 'array', items: { type: 'string' } },
    auditNotes: { type: 'array', items: { type: 'string' } },
  },
  $defs: recognitionSchema.$defs,
} as const

function readResponseText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return ''
  const direct = (payload as { output_text?: unknown }).output_text
  if (typeof direct === 'string') return direct

  const output = (payload as { output?: unknown }).output
  if (!Array.isArray(output)) return ''

  for (const item of output) {
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string') return text
    }
  }

  return ''
}

function readChatCompletionText(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return ''
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return ''
  const firstChoice = choices[0] as { message?: { content?: unknown } } | undefined
  const content = firstChoice?.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => ((part as { text?: unknown }).text))
    .filter((text): text is string => typeof text === 'string')
    .join('\n')
}

function parseJson<T>(text: string): T {
  const trimmed = text.trim()
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(unfenced) as T
  } catch {
    const start = unfenced.indexOf('{')
    const end = unfenced.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('模型返回内容不是可解析的 JSON。')
    return JSON.parse(unfenced.slice(start, end + 1)) as T
  }
}

function parseRecognitionJson(text: string): RecognitionResult {
  return parseJson<RecognitionResult>(text)
}

function buildApiUrl(baseUrl: string, path: string) {
  const base = (baseUrl.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/g, '')
  if (base.endsWith('/v1') && path.startsWith('/v1/')) return `${base}${path.slice(3)}`
  return `${base}${path}`
}

function shouldRetryChatCompletionWithoutResponseFormat(status: number, errorText: string) {
  if (status !== 400 && status !== 422) return false
  return /response_format|json_object|unsupported|not supported|invalid/i.test(errorText)
}

async function fetchChatCompletionText({
  apiBaseUrl,
  apiKey,
  body,
  outputLabel,
}: {
  apiBaseUrl: string
  apiKey: string
  body: Record<string, unknown>
  outputLabel: string
}) {
  const request = async (requestBody: Record<string, unknown>) =>
    fetch(buildApiUrl(apiBaseUrl, '/v1/chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

  const response = await request(body)
  if (response.ok) {
    const payload = (await response.json()) as unknown
    const text = readChatCompletionText(payload)
    if (!text) throw new Error(`Chat Completions response did not include ${outputLabel}.`)
    return text
  }

  const errorText = await response.text()
  if (
    'response_format' in body &&
    shouldRetryChatCompletionWithoutResponseFormat(response.status, errorText)
  ) {
    const fallbackBody = { ...body }
    delete fallbackBody.response_format
    const fallbackResponse = await request(fallbackBody)
    if (fallbackResponse.ok) {
      const payload = (await fallbackResponse.json()) as unknown
      const text = readChatCompletionText(payload)
      if (!text) throw new Error(`Chat Completions response did not include ${outputLabel}.`)
      return text
    }

    const fallbackErrorText = await fallbackResponse.text()
    throw new Error(
      fallbackErrorText || errorText || `Chat Completions request failed: ${fallbackResponse.status}`,
    )
  }

  throw new Error(errorText || `Chat Completions request failed: ${response.status}`)
}

function buildRecognitionInstruction(prompt: SmartPrompt, includeSchema: boolean) {
  const lines = [
    '你是 tong账本计算器 的票据识别引擎。',
    '请严格基于图片内容输出 JSON，不要编造看不见的内容。',
    '本产品当前只处理一张完整单页账本照片，不做多页拼接，也不接受半页/局部图作为最终结果。',
    '识别前先检查整页条件：表格四角、表头单价行、日期列、1日至31日应在同一张图片中可见。若不完整，在 auditNotes 写 pageIncomplete/cuttingRisk，overallConfidence 不得高于 0.55，并说明缺失区域。',
    '在计算前，必须先识别表头/列头/第一行单价/倍率/单位。手写账本里写在列上方的小数通常是该列纸类的单价或倍率，具体按用户纸张模板解释。',
    'entries.amount 保留原始可读数值；entries.rawValue 同样保留原始数值；entries.multiplier 写该列单价或倍率；entries.calculatedAmount 写 rawValue * multiplier 后的入账金额。',
    'computedTotal 必须是所有应计入 entries.calculatedAmount 的合计。若图片本身没有倍率，则 multiplier 用 1。',
    '所有 region 坐标使用相对百分比：x/y/width/height 均为 0-100。region 是粗定位参考，不要假装像素级精确；如果图片透视明显，请尽量标在该数字所在单元格中心附近，并用足够小的区域表示不确定定位。',
    '图片上已经覆盖蓝色定位锚点，锚点编号形如 A1、B7、F10。每个 entries 和 uncertainMarks 必须尽量填写最近的 anchor：anchorId 是最近锚点编号，offsetX/offsetY 是相对该锚点的百分比偏移，范围 -8 到 8。不能判断时 anchor 用 null。',
    '定位优先级：先用锚点编号描述目标位置，再用 region 给粗略备用位置。不要把蓝色锚点本身当成账本内容。',
    '如果是表格账本，优先按行列关系理解数字：先确定表头倍率、列位置、日期行，再从上到下扫描完整 31 个日期行，输出每个数字的大致单元格位置。',
    '固定账本默认列为：日期、上班、纸类1、纸类2、纸类3、纸类4、上下货、扣款、日合计。能判断格子时，entries.cellId 使用 r{日期}-{列id}，列 id 可用 attendance、paper-1、paper-2、paper-3、paper-4、unloading、deduction。',
    '程序会根据固定网格重新切格；你负责给数字 token 的位置、语义和格子归属，不要用整行大框代替单个数字或格子。',
    '表格账本必须先找日期/行号列和横线网格，按每个日期行的上下边界分配数字；不要因为手写数字靠近上一行或下一行就把它错配到相邻日期。',
    'X、空白、划掉的非金额标记不要作为 entries 里的金额条目；可以写入 extractedText 或 auditNotes。',
    'confidence 由你根据图片清晰度、字符歧义、遮挡和计算影响综合判断。',
    '低置信字符必须放入 uncertainMarks。',
    '你会收到三张图片：第一张是原图；第二张是 OCR 预处理增强图，请优先用它识别文字和数字；第三张是带蓝色锚点的预处理图，只用于定位 anchor，不要把蓝色覆盖物当内容。',
    `用户选择的智能 prompt：${prompt.name}`,
    prompt.prompt,
  ]

  if (includeSchema) {
    lines.push(
      '只返回一个 JSON 对象，不要 Markdown，不要解释文字。JSON 必须匹配下面的结构；缺失字段用空字符串、空数组或 null 补齐。',
      JSON.stringify(recognitionSchema),
    )
  }

  return lines.join('\n')
}

function buildVisualExtractionInstruction(prompt: SmartPrompt, includeSchema: boolean) {
  const lines = [
    '你是 tong账本计算器 的视觉定位引擎。',
    '这一阶段只做一件事：从图片中抽取“位置 + 可见字符/数字候选”的组合，不要做最终账单计算。',
    '输入应是一张完整单页账本照片；如果图中缺四角、表头或 1日至31日中的任何连续区域，仍输出可见 token，但必须在 auditNotes 写 pageIncomplete/cuttingRisk。',
    '使用深度复读流程：先识别整张表格结构和行列，再从上到下逐行读数，最后反向从下到上检查是否漏项。只输出最终结构化结果，不输出思考过程。',
    '必须输出所有可见的手写数字、表头倍率、小数、X/划线/非金额标记，以及对理解账本有帮助的打印文字。',
    '每个目标输出为 token：kind、rowLabel、columnLabel、rawText、normalizedText、numericValue、candidates、confidence、region、anchor。',
    '固定账本默认列为：日期、上班、纸类1、纸类2、纸类3、纸类4、上下货、扣款、日合计；rowLabel 必须尽量写成“16日”这种日期行，columnLabel 必须写成固定列名之一。',
    'number 表示普通手写数字；multiplier 表示表头倍率/小数；mark 表示 X、划掉、空白标记；text 表示标题、日期、行号等辅助文字。',
    '对每个手写数字，候选值至少给出最可能值；如果存在 7/1、5/8、0/6、3/8、连笔等歧义，candidates 必须列出备选和置信度。',
    'region 坐标使用原图相对百分比 x/y/width/height，0-100。定位到字符或数字所在区域，不要用覆盖整行的大框。',
    '图片上已经覆盖蓝色定位锚点，锚点编号形如 A1、B7、F10。anchor 只用于定位，不能当成账本内容。',
    '你会收到三张图片：第一张是原图，用于判断真实场景和遮挡；第二张是 OCR 预处理增强图，请优先用它读取手写/打印文字；第三张是在预处理图上覆盖蓝色锚点的定位参考图。',
    '不要把倍率应用到数字，不要输出 computedTotal，不要删除低置信目标；看不清也要输出候选 token。',
    '同一位置至少对照原图和增强图两次；二者读数不一致时保留多个 candidates，并降低 confidence，不要强行确定。',
    `用户选择的智能 prompt：${prompt.name}`,
    prompt.prompt,
  ]

  if (includeSchema) {
    lines.push(
      '只返回一个 JSON 对象，不要 Markdown，不要解释文字。JSON 必须匹配下面结构。',
      JSON.stringify(visualExtractionSchema),
    )
  }

  return lines.join('\n')
}

function buildCalculationProgramInstruction(
  prompt: SmartPrompt,
  extraction: VisualExtractionResult,
  includeSchema: boolean,
) {
  const lines = [
    '你是 tong账本计算器 的计算程序生成器。',
    '你不会看图片；你只读取上一阶段视觉定位结果，并生成 tong-ledger-dsl/v1 计算 DSL。',
    '你的任务是判断哪些 visual tokens 是金额、哪些是倍率/列规则/非金额标记，并把每个应计入金额写成一个 term。',
    '先建立列规则，再逐行生成 term，最后检查每个 number token 是否已被引用或明确排除。只输出 DSL，不输出思考过程。',
    '不要输出最终 computedTotal。最终数学计算由前端执行。',
    'terms 中每一项必须引用 sourceTokenIds；rawValue 是原始数字，multiplier 是该列倍率，include 表示是否计入。',
    'formula 写成人类可读的单项公式，例如 570 x 0.088。不要写可执行 JavaScript。',
    'X、空白、划掉且非金额的标记 include=false 或不放入 terms；有风险的数字放入 uncertainMarks。',
    '如果视觉候选里存在多个可能值，必须结合行列、倍率、日期连续性和用户 prompt 选择最合理 rawValue，并在 note/uncertainMarks 说明。',
    '同一垂直列应使用同一个表头倍率；表格账本必须优先按日期行和列头归属，不要只按文字顺序相加。',
    '生成 term 时保留固定格子语义：上班列的 0.5 是半天，纸类列的 0.5 是数量；上下货是直接金额，扣款是负向调整。',
    '不得根据期望总额倒推或修改数字；只能依据 token、位置、行列与用户规则决定。',
    `用户选择的智能 prompt：${prompt.name}`,
    prompt.prompt,
    '上一阶段视觉定位 JSON：',
    JSON.stringify(extraction),
  ]

  if (includeSchema) {
    lines.push(
      '只返回一个 JSON 对象，不要 Markdown，不要解释文字。JSON 必须匹配下面结构。',
      JSON.stringify(calculationProgramSchema),
    )
  }

  return lines.join('\n')
}

function buildAuditInstruction(prompt: SmartPrompt, firstResult: RecognitionResult, includeSchema: boolean) {
  const lines = [
    '你是 tong账本计算器 的第二阶段审计引擎。',
    '你会看到同一张账本图片，以及第一阶段模型输出的 JSON。',
    '先审查这是否是一张完整单页账本：四角、表头、日期列和 1日至31日是否可见；不完整时必须保留 pageIncomplete/cuttingRisk 审计说明，不能把局部识别包装成完整总额。',
    '任务不是重新随意发挥，而是逐项审查第一阶段结果：表头倍率、每行日期、每列数字、X/空白、computedTotal、region 和 anchor。',
    '先暂时忽略第一阶段具体读数，独立从图片逐行复读；完成后再与第一阶段逐项比较，只修改有图像证据支持的差异。',
    '请特别关注这些高风险错误：行号错位、把右列数字读成中列数字、漏读同一行的第二个数字、把 7/1/9/0 连笔误读、把划线或 X 当金额。',
    '审计时先建立日期行网格：找到打印的日期/行号，按行带重新检查每个手写数字属于哪一天；上半部分如果数字密集，优先相信横线网格而不是第一阶段的行号。',
    '如果同一日期附近有两个金额，分别属于不同倍率列；不要把同一行的右列金额错挪到下一天。',
    'X、空白、划掉的非金额标记不要作为 entries；只保留真正参与计算或需要人工核验的金额数字。',
    '如果第一阶段结果与图片不一致，以图片为准修正；如果图片确实看不清，在 uncertainMarks 写明候选值和理由。',
    'computedTotal 必须重新根据修正后的 entries.calculatedAmount 计算，不要沿用第一阶段总额。',
    '审计结束前执行三项检查：可见金额数量是否完整、每项是否属于正确行列、前端可重算金额之和是否一致。',
    '保留完整 entries，不要为了省略而删除可见金额。每个可见金额都要有 region；能判断最近蓝色锚点时也要有 anchor。',
    '你会收到三张图片：第一张是原图；第二张是 OCR 预处理增强图，请优先用它复核文字和数字；第三张是带蓝色锚点的预处理图，只用于定位 anchor。',
    `用户选择的智能 prompt：${prompt.name}`,
    prompt.prompt,
    '第一阶段 JSON：',
    JSON.stringify(firstResult),
  ]

  if (includeSchema) {
    lines.push(
      '只返回修正后的一个 JSON 对象，不要 Markdown，不要解释文字。JSON 必须匹配下面的结构；缺失字段用空字符串、空数组或 null 补齐。',
      JSON.stringify(recognitionSchema),
    )
  }

  return lines.join('\n')
}

function buildReconcileInstruction(
  prompt: SmartPrompt,
  auditedResult: RecognitionResult,
  includeSchema: boolean,
) {
  const lines = [
    '你是 tong账本计算器 的最终一致性复核引擎。',
    '你会看到同一张账本图片，以及上一阶段已经审计过的 JSON。',
    '最终结果必须仍然满足单页整扫：如果图片缺表头、缺日期行或只拍到局部，保留低置信和 pageIncomplete/cuttingRisk，不要输出静默通过的完整账。',
    '这一步只做最终纠偏：按日期行网格、列倍率和算术一致性复核，不要因为上一阶段给出高置信就放弃检查。',
    '优先复核低置信、候选冲突、相邻行数值相似和会显著影响总额的项目；对这些项目必须重新查看原图笔画。',
    '逐行核对 1日至31日：X/空白不作为金额；每个手写金额必须归入正确日期行和正确倍率列。',
    '不要随意改变已确定的列单价/倍率：同一垂直列必须沿用表头或纸张模板给出的单价；只有当图片中数字明显落在另一列时才改 multiplier。',
    '如果最终复核无法更可靠地纠正某个单元格，保留上一阶段结果并降低 confidence，不要凭规律猜大改。',
    '如果数字与行列规律冲突，优先回看原图；如果仍不清楚，保留最可能值并把候选写入 uncertainMarks。',
    '最后重算 computedTotal，确保它等于所有 entries.calculatedAmount 的合计。',
    '不得为了得到某个预期总额而改数；如果无法从图片消除歧义，保留候选并降低 confidence。',
    '输出完整最终 JSON，不要输出差异补丁。',
    '你会收到三张图片：第一张是原图；第二张是 OCR 预处理增强图用于读数；第三张是带蓝色锚点的预处理图。',
    `用户选择的智能 prompt：${prompt.name}`,
    prompt.prompt,
    '上一阶段 JSON：',
    JSON.stringify(auditedResult),
  ]

  if (includeSchema) {
    lines.push(
      '只返回最终 JSON 对象，不要 Markdown，不要解释文字。JSON 必须匹配下面的结构；缺失字段用空字符串、空数组或 null 补齐。',
      JSON.stringify(recognitionSchema),
    )
  }

  return lines.join('\n')
}

export async function recognizeLedgerImage({
  apiBaseUrl,
  apiKey,
  apiMode,
  imageDataUrl,
  preprocessedImageDataUrl,
  model,
  prompt,
  qualityMode,
}: {
  apiBaseUrl: string
  apiKey: string
  apiMode: ApiMode
  imageDataUrl: string
  preprocessedImageDataUrl?: string
  model: string
  prompt: SmartPrompt
  qualityMode: QualityMode
}): Promise<RecognitionResult> {
  const readableImageDataUrl = preprocessedImageDataUrl || imageDataUrl
  const anchoredImageDataUrl = await annotateImageWithAnchors(readableImageDataUrl, undefined, {
    maxSize: 1200,
    quality: 0.72,
  })

  const visualExtraction =
    apiMode === 'chatCompletions'
      ? await extractVisualTargetsWithChatCompletions({
          apiBaseUrl,
          apiKey,
          anchoredImageDataUrl,
          imageDataUrl,
          preprocessedImageDataUrl: readableImageDataUrl,
          model,
          prompt,
        })
      : await extractVisualTargetsWithResponses({
          apiBaseUrl,
          apiKey,
          anchoredImageDataUrl,
          imageDataUrl,
          preprocessedImageDataUrl: readableImageDataUrl,
          model,
          prompt,
        })

  const calculationProgram =
    apiMode === 'chatCompletions'
      ? await createCalculationProgramWithChatCompletions({
          apiBaseUrl,
          apiKey,
          extraction: visualExtraction,
          model,
          prompt,
        })
      : await createCalculationProgramWithResponses({
          apiBaseUrl,
          apiKey,
          extraction: visualExtraction,
          model,
          prompt,
        })

  const firstResult = executeCalculationProgram(visualExtraction, calculationProgram)

  if (qualityMode === 'fast') return firstResult

  const auditedResult =
    apiMode === 'chatCompletions'
      ? await recognizeWithChatCompletions({
          apiBaseUrl,
          apiKey,
          anchoredImageDataUrl,
          firstResult,
          imageDataUrl,
          preprocessedImageDataUrl: readableImageDataUrl,
          model,
          prompt,
          stage: 'audit',
        })
      : await recognizeWithResponses({
          apiBaseUrl,
          apiKey,
          anchoredImageDataUrl,
          firstResult,
          imageDataUrl,
          preprocessedImageDataUrl: readableImageDataUrl,
          model,
          prompt,
          stage: 'audit',
        })

  const auditedWithPipeline = {
    ...auditedResult,
    calculationProgram: auditedResult.calculationProgram ?? firstResult.calculationProgram,
    visualTokens: auditedResult.visualTokens ?? firstResult.visualTokens,
  }

  if (qualityMode !== 'max') return normalizeRecognitionResult(auditedWithPipeline)

  const reconciledResult = apiMode === 'chatCompletions'
    ? recognizeWithChatCompletions({
        apiBaseUrl,
        apiKey,
        anchoredImageDataUrl,
        firstResult: auditedWithPipeline,
        imageDataUrl,
        preprocessedImageDataUrl: readableImageDataUrl,
        model,
        prompt,
        stage: 'reconcile',
      })
    : recognizeWithResponses({
        apiBaseUrl,
        apiKey,
        anchoredImageDataUrl,
        firstResult: auditedWithPipeline,
        imageDataUrl,
        preprocessedImageDataUrl: readableImageDataUrl,
        model,
        prompt,
        stage: 'reconcile',
      })

  const reconciled = await reconciledResult
  return normalizeRecognitionResult({
    ...reconciled,
    calculationProgram: reconciled.calculationProgram ?? firstResult.calculationProgram,
    visualTokens: reconciled.visualTokens ?? firstResult.visualTokens,
  })
}

async function extractVisualTargetsWithResponses({
  apiBaseUrl,
  apiKey,
  anchoredImageDataUrl,
  imageDataUrl,
  preprocessedImageDataUrl,
  model,
  prompt,
}: {
  apiBaseUrl: string
  apiKey: string
  anchoredImageDataUrl: string
  imageDataUrl: string
  preprocessedImageDataUrl: string
  model: string
  prompt: SmartPrompt
}) {
  const response = await fetch(buildApiUrl(apiBaseUrl, '/v1/responses'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: buildVisualExtractionInstruction(prompt, false) },
            { type: 'input_image', image_url: imageDataUrl, detail: 'high' },
            {
              type: 'input_text',
              text: '第二张图片是 OCR 预处理增强图，请优先用它读文字、数字、小数点和手写笔画。',
            },
            { type: 'input_image', image_url: preprocessedImageDataUrl, detail: 'high' },
            {
              type: 'input_text',
              text: '第三张图片是带蓝色锚点的预处理图，只用于 anchor/region 定位。',
            },
            { type: 'input_image', image_url: anchoredImageDataUrl, detail: 'high' },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'tong_ledger_visual_extraction',
          strict: true,
          schema: visualExtractionSchema,
        },
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `OpenAI request failed: ${response.status}`)
  }

  const payload = (await response.json()) as unknown
  const text = readResponseText(payload)
  if (!text) throw new Error('OpenAI response did not include visual extraction output.')

  return parseJson<VisualExtractionResult>(text)
}

async function createCalculationProgramWithResponses({
  apiBaseUrl,
  apiKey,
  extraction,
  model,
  prompt,
}: {
  apiBaseUrl: string
  apiKey: string
  extraction: VisualExtractionResult
  model: string
  prompt: SmartPrompt
}) {
  const response = await fetch(buildApiUrl(apiBaseUrl, '/v1/responses'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: buildCalculationProgramInstruction(prompt, extraction, false),
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'tong_ledger_calculation_program',
          strict: true,
          schema: calculationProgramSchema,
        },
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `OpenAI request failed: ${response.status}`)
  }

  const payload = (await response.json()) as unknown
  const text = readResponseText(payload)
  if (!text) throw new Error('OpenAI response did not include calculation program output.')

  return parseJson<CalculationProgram>(text)
}

async function extractVisualTargetsWithChatCompletions({
  apiBaseUrl,
  apiKey,
  anchoredImageDataUrl,
  imageDataUrl,
  preprocessedImageDataUrl,
  model,
  prompt,
}: {
  apiBaseUrl: string
  apiKey: string
  anchoredImageDataUrl: string
  imageDataUrl: string
  preprocessedImageDataUrl: string
  model: string
  prompt: SmartPrompt
}) {
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildVisualExtractionInstruction(prompt, true) },
          { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
          {
            type: 'text',
            text: '第二张图片是 OCR 预处理增强图，请优先用它读文字、数字、小数点和手写笔画。',
          },
          { type: 'image_url', image_url: { url: preprocessedImageDataUrl, detail: 'high' } },
          {
            type: 'text',
            text: '第三张图片是带蓝色锚点的预处理图，只用于 anchor/region 定位。',
          },
          { type: 'image_url', image_url: { url: anchoredImageDataUrl, detail: 'high' } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  }

  const text = await fetchChatCompletionText({
    apiBaseUrl,
    apiKey,
    body,
    outputLabel: 'visual extraction output',
  })

  return parseJson<VisualExtractionResult>(text)
}

async function createCalculationProgramWithChatCompletions({
  apiBaseUrl,
  apiKey,
  extraction,
  model,
  prompt,
}: {
  apiBaseUrl: string
  apiKey: string
  extraction: VisualExtractionResult
  model: string
  prompt: SmartPrompt
}) {
  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildCalculationProgramInstruction(prompt, extraction, true) },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  }

  const text = await fetchChatCompletionText({
    apiBaseUrl,
    apiKey,
    body,
    outputLabel: 'calculation program output',
  })

  return parseJson<CalculationProgram>(text)
}

async function recognizeWithResponses({
  apiBaseUrl,
  apiKey,
  anchoredImageDataUrl,
  imageDataUrl,
  preprocessedImageDataUrl,
  firstResult,
  model,
  prompt,
  stage,
}: {
  apiBaseUrl: string
  apiKey: string
  anchoredImageDataUrl: string
  imageDataUrl: string
  preprocessedImageDataUrl: string
  firstResult?: RecognitionResult
  model: string
  prompt: SmartPrompt
  stage: 'recognition' | 'audit' | 'reconcile'
}) {
  const instruction =
    stage === 'reconcile' && firstResult
      ? buildReconcileInstruction(prompt, firstResult, false)
      : stage === 'audit' && firstResult
        ? buildAuditInstruction(prompt, firstResult, false)
        : buildRecognitionInstruction(prompt, false)

  const response = await fetch(buildApiUrl(apiBaseUrl, '/v1/responses'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: instruction,
            },
            {
              type: 'input_image',
              image_url: imageDataUrl,
              detail: 'high',
            },
            {
              type: 'input_text',
              text: '第二张图片是 OCR 预处理增强图，请优先用它复核文字、数字、小数点和手写笔画。',
            },
            {
              type: 'input_image',
              image_url: preprocessedImageDataUrl,
              detail: 'high',
            },
            {
              type: 'input_text',
              text: '第三张图片是带蓝色锚点的预处理图，只用于 anchor/region 定位。',
            },
            {
              type: 'input_image',
              image_url: anchoredImageDataUrl,
              detail: 'high',
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'tong_ledger_recognition',
          strict: true,
          schema: recognitionSchema,
        },
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `OpenAI request failed: ${response.status}`)
  }

  const payload = (await response.json()) as unknown
  const text = readResponseText(payload)
  if (!text) throw new Error('OpenAI response did not include structured text output.')

  return parseRecognitionJson(text)
}

async function recognizeWithChatCompletions({
  apiBaseUrl,
  apiKey,
  anchoredImageDataUrl,
  imageDataUrl,
  preprocessedImageDataUrl,
  firstResult,
  model,
  prompt,
  stage,
}: {
  apiBaseUrl: string
  apiKey: string
  anchoredImageDataUrl: string
  imageDataUrl: string
  preprocessedImageDataUrl: string
  firstResult?: RecognitionResult
  model: string
  prompt: SmartPrompt
  stage: 'recognition' | 'audit' | 'reconcile'
}) {
  const instruction =
    stage === 'reconcile' && firstResult
      ? buildReconcileInstruction(prompt, firstResult, true)
      : stage === 'audit' && firstResult
        ? buildAuditInstruction(prompt, firstResult, true)
        : buildRecognitionInstruction(prompt, true)

  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: instruction,
          },
          {
            type: 'image_url',
            image_url: {
              url: imageDataUrl,
              detail: 'high',
            },
          },
          {
            type: 'text',
            text: '第二张图片是 OCR 预处理增强图，请优先用它复核文字、数字、小数点和手写笔画。',
          },
          {
            type: 'image_url',
            image_url: {
              url: preprocessedImageDataUrl,
              detail: 'high',
            },
          },
          {
            type: 'text',
            text: '第三张图片是带蓝色锚点的预处理图，只用于 anchor/region 定位。',
          },
          {
            type: 'image_url',
            image_url: {
              url: anchoredImageDataUrl,
              detail: 'high',
            },
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  }

  const text = await fetchChatCompletionText({
    apiBaseUrl,
    apiKey,
    body,
    outputLabel: 'message content',
  })

  return parseRecognitionJson(text)
}
