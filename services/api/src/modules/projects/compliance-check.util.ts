/**
 * 终稿合规检验工具（AQ-297~301）
 */

import { randomUUID } from 'node:crypto';
import type { ContentSafetyRule } from '@aether-quill/config';
import {
  PIPELINE_OUTLINE_JSON_OUTPUT_RULE,
  filterPipelinePersonas,
  sanitizeSensoryOutlineWithContentScan,
  type FinalPolishQualityStatus,
  type PipelineOutlineItem,
  type PipelineRuleIssue,
} from './chapter-pipeline.util';
import { extractCardDisplayName } from '../documents/persona-card-link.util';

export const CHAPTER_COMPLIANCE_OUTLINE_TEMPLATE_KEY = 'chapter.compliance.outline';
export const CHAPTER_COMPLIANCE_REWRITE_TEMPLATE_KEY = 'chapter.compliance.rewrite';
export const CHAPTER_COMPLIANCE_COVERAGE_VERIFY_TEMPLATE_KEY = 'chapter.compliance.coverage.verify';
export const CHAPTER_COMPLIANCE_REWRITE_FIX_ITEMS_TEMPLATE_KEY = 'chapter.compliance.rewrite.fix-items';

export const CHAPTER_COMPLIANCE_TEMPLATE_KEYS = [
  CHAPTER_COMPLIANCE_OUTLINE_TEMPLATE_KEY,
  CHAPTER_COMPLIANCE_REWRITE_TEMPLATE_KEY,
  CHAPTER_COMPLIANCE_COVERAGE_VERIFY_TEMPLATE_KEY,
  CHAPTER_COMPLIANCE_REWRITE_FIX_ITEMS_TEMPLATE_KEY,
] as const;

export const COMPLIANCE_ERROR = {
  sessionNotFound: 1332,
  outlineNotConfirmed: 1333,
  qualityBlocked: 1334,
  unsupportedTemplate: 1335,
} as const;

export type ComplianceCheckStatus =
  | 'outline_pending'
  | 'outline_ready'
  | 'rewriting'
  | 'review'
  | 'applied'
  | 'cancelled';

export type ComplianceOutlineReviseMode = 'recheck' | 'revise';

export interface ComplianceOutlineState {
  required: PipelineOutlineItem[];
  suggested: PipelineOutlineItem[];
  userConfirmed: boolean;
  revisionRound: number;
  revisionHistory?: Array<{ required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] }>;
  confirmedAt?: string;
}

export interface ComplianceCheckSession {
  sessionId: string;
  projectId: string;
  chapterNo: number;
  status: ComplianceCheckStatus;
  sourceText: string;
  /** 复用本章最近一次创作精修检索预览确认的角色名；无则合规阶段回退全部已发布人物 */
  selectedPersonaNames?: string[];
  outline?: ComplianceOutlineState;
  versionText?: string;
  preScanIssues?: PipelineRuleIssue[];
  residualIssues?: PipelineRuleIssue[];
  qualityStatus?: FinalPolishQualityStatus;
  traceIds: { outline?: string; rewrite?: string; rescan?: string; preScan?: string };
  createdAt: Date;
  updatedAt: Date;
}

export const COMPLIANCE_OUTLINE_REVISE_FEEDBACK_MAX_CHARS = 2000;

/** 终稿合规大纲内置禁用词（解剖 / 低俗网络 / 出戏）；命中写入大纲，不整段重写。 */
export const CHAPTER_COMPLIANCE_OUTLINE_FORBIDDEN_WORDS = [
  '解剖词：阴道壁、阴道口、宫颈口、宫颈管、括约肌、盆底肌、腹直肌、舌系带、舌根、软腭、硬腭、包皮沟、尿道口、尿道、阴囊、睾丸、前庭、黏膜、子宫腔、卵巢、输卵管、口腔。',
  '低俗/网络词：大屌、骚穴、骚水、操烂、劈开、炸开、贯穿、捣碎、撞散、白光、脑海空白、生理盐水、研磨、磨蹭、搅拌、卵蛋、子孙袋。',
  '出戏词：G点、花心口、核心、肌肉群、核心肌群、发力、张力带、扭矩、活塞式、应激反应。',
].join('\n');

export const CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT = [
  '你是一位资深内容合规编辑，正在对小说章节正文做「发布前合规检验」并输出修改计划。',
  'ONLY：识别合规风险与必要修改项，输出 JSON 大纲；禁止输出改写后正文、禁止 Markdown 代码块。',
  '本步骤只查三件事：①禁用词清单与项目高危禁用词 ②人物动作/空间是否物理可行 ③人物卡人设/称谓/关系/外观是否一致。不得借机改写剧情或文风。',
  '情色、性爱、身体描写本身不是违规；未命中禁用词且动作空间自洽，一律不标。',
  '检查人物动作合理性、空间合理性：体位、手脚位置、重心、衣着与场景物件须对得上；头/手够不到的部位、穿墙等，写入大纲（category 可用 action_space）。同一体位矛盾合并为一条。',
  '占用以时间顺序的最新状态为准，禁止把前后句动作叠成同一瞬间。先双手做某事、后文一只手离开再做另一事，不是占用冲突；同一只手从A滑到B，不要拆成两只手。只有同一瞬间双手仍被占用却另做第三件事，或一只手同时做两件互斥的事，才标。',
  '动作/空间修改方向只写真实同时冲突的占用变化。禁止把先后动作改写成「单手……另一只手……」对账句，也禁止建议「明确先单手再双手」。',
  '基于禁用词检查：仅当正文出现下列清单词或【项目高危禁用词参考】中的词（需完整匹配，比如「子宫」为非禁用词）才写入大纲（category 用 forbidden_expression）。同一词全文只写一条，定位举 1～3 处即可；修改方向为替换，不整段重写。',
  '禁止把未列入清单的词扩成禁用词（例如清单没有「龟头」「肉棒」「小穴」「阴茎」时，不得当作解剖词）。',
  '出戏词仅在身体/性爱动作描写里当作健身或力学黑话时记 required；日常叙事误伤记 suggested。',
  '同类问题合并为一条，禁止按段落逐条抄写；required 最多 12 条，suggested 最多 8 条；不要把「无风险 / 无需修改」写成条目。无命中则两个数组均为 []。',
  '【禁用词】',
  CHAPTER_COMPLIANCE_OUTLINE_FORBIDDEN_WORDS,
  '若提供【人物卡参考】：须核对正文与人设、称谓、关系、外观描述是否一致；不一致项写入大纲（category 可用 consistency）。',
  '【人物卡参考】以关联角色卡全文为准。角色卡已写明的外观、籍贯、标志性特征，不得标「未记载」。',
  '保持原文人称、叙事视角与核心情节不变；修改计划须可定位到具体片段。',
  PIPELINE_OUTLINE_JSON_OUTPUT_RULE,
  'category 建议取值：forbidden_expression | consistency | action_space | other（写入 text 即可，勿拆字段）。',
].join('\n');

export const CHAPTER_COMPLIANCE_REWRITE_SYSTEM_PROMPT = [
  '你是一位资深内容合规编辑，正在按已确认的合规大纲修改章节正文。',
  'ONLY：落实大纲中的合规修改项；禁止扩写剧情、新增设定/人物、改变因果顺序。',
  '若提供【人物卡参考】：改写时保持与人设一致，仅修正大纲标注的合规/一致性问题。',
  '保持原文人称、语气与叙事风格；只改合规问题相关片段。',
  '落实动作/空间时，只改同一瞬间确实冲突的原句；先后动作保持原文顺序，禁止把「先双手、后一手离开」改成「单手……另一只手……」。禁止另插对账句，也不要为对账而点名左右乳。',
  '直接输出完整正文，不要 JSON、不要说明或 Markdown。',
].join('\n');

const COMPLIANCE_OUTLINE_JSON_FORMAT = [
  '【检查范围 ONLY】禁用词清单与项目高危禁用词；动作/空间物理矛盾；人物卡不一致。',
  '情色/性爱描写本身不是违规。禁止平台色情审核、禁止扩写未列入的词、禁止按段落抄写、禁止「风险：无」。',
  '禁用词须完整匹配；「子宫」不是禁用词，仅「子宫腔」在清单内。',
  '动作空间只标同一瞬间的占用冲突；先后动作、一只手离开后再做，一律不标。禁止「单手/另一只手」对账改写建议。',
  '角色卡已记载的外观/籍贯不得标「未记载」。',
  '输出 JSON：{"required":[{"id":"r1","text":"...","priority":"required"}],"suggested":[{"id":"s1","text":"...","priority":"suggested"}]}',
  '每条 text 须含：问题定位 + 违规/风险说明 + 修改方向。同一禁用词或同一空间矛盾合并为一条。',
  'required 最多 12 条，suggested 最多 8 条；无命中则两个数组均为 []。',
].join('\n');

export const COMPLIANCE_OUTLINE_MAX_REQUIRED = 12;
export const COMPLIANCE_OUTLINE_MAX_SUGGESTED = 8;

export function capComplianceOutlineItems(outline: {
  required: PipelineOutlineItem[];
  suggested: PipelineOutlineItem[];
}): { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] } {
  return {
    required: outline.required.slice(0, COMPLIANCE_OUTLINE_MAX_REQUIRED),
    suggested: outline.suggested.slice(0, COMPLIANCE_OUTLINE_MAX_SUGGESTED),
  };
}

const COMPLIANCE_FORBIDDEN_ITEM_HINT =
  /forbidden_expression|禁用词|解剖词|出戏词|低俗/;

/** 从内置禁用词清单解析完整词条（不含「子宫」等未列入的前缀）。 */
export function listComplianceForbiddenTerms(
  forbiddenWordsBlock: string = CHAPTER_COMPLIANCE_OUTLINE_FORBIDDEN_WORDS
): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const line of forbiddenWordsBlock.split('\n')) {
    const separator = line.indexOf('：');
    const body = separator >= 0 ? line.slice(separator + 1) : line;
    for (const raw of body.split('、')) {
      const term = raw.replace(/[。．.]+$/g, '').trim();
      if (!term || seen.has(term)) {
        continue;
      }
      seen.add(term);
      terms.push(term);
    }
  }
  return terms;
}

export function listProjectHighRiskForbiddenTerms(rules: ContentSafetyRule[]): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    if (rule.severity !== 'high' && rule.action !== 'block') {
      continue;
    }
    const term = rule.pattern?.trim();
    if (!term || seen.has(term)) {
      continue;
    }
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

function looksLikeForbiddenExpressionItem(text: string): boolean {
  return COMPLIANCE_FORBIDDEN_ITEM_HINT.test(text);
}

function itemCitesMatchedForbiddenTerm(
  itemText: string,
  sourceText: string,
  terms: string[]
): boolean {
  return terms.some((term) => itemText.includes(term) && sourceText.includes(term));
}

/**
 * 丢掉模型把未列入词（如「子宫」相对「子宫腔」）扩成禁用词的大纲项。
 * 动作/空间、人设一致性条目不处理。
 */
export function dropUnmatchedForbiddenOutlineItems(
  outline: { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] },
  sourceText: string,
  projectForbiddenTerms: string[] = []
): { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] } {
  const terms = [
    ...listComplianceForbiddenTerms(),
    ...projectForbiddenTerms.map((term) => term.trim()).filter(Boolean),
  ];
  const keep = (item: PipelineOutlineItem): boolean => {
    if (!looksLikeForbiddenExpressionItem(item.text)) {
      return true;
    }
    return itemCitesMatchedForbiddenTerm(item.text, sourceText, terms);
  };
  return {
    required: outline.required.filter(keep),
    suggested: outline.suggested.filter(keep),
  };
}

const COMPLIANCE_MISSING_CARD_HINT = /未记载|未写明|人物卡未|角色卡未/;
const COMPLIANCE_FEATURE_STOPWORDS = new Set([
  '那种',
  '那个',
  '这个',
  '正文',
  '人物',
  '角色',
  '设定',
  '记载',
  '出现',
  '反复',
  '强调',
  '建议',
  '删除',
  '补充',
  '标志',
  '特征',
  '否则',
  '若为',
  '提及',
]);

function extractQuotedFeatureSpans(text: string): string[] {
  return [...text.matchAll(/[「『“"]([^」』”"]{2,40})[」』”"]/g)].map((match) => match[1] ?? '');
}

function quoteSupportedByPersonaBlock(quote: string, personaBlock: string): boolean {
  const trimmed = quote.trim();
  if (trimmed.length < 2) {
    return false;
  }
  if (personaBlock.includes(trimmed)) {
    return true;
  }
  for (let length = trimmed.length; length >= 2; length -= 1) {
    for (let index = 0; index + length <= trimmed.length; index += 1) {
      const slice = trimmed.slice(index, index + length);
      if (COMPLIANCE_FEATURE_STOPWORDS.has(slice)) {
        continue;
      }
      if (personaBlock.includes(slice)) {
        return true;
      }
    }
  }
  return false;
}

const ACTION_SPACE_OCCUPANCY_HINT =
  /action_space|占用冲突|占用矛盾|双手已被占用|第三只手|第三件事|同时做两件/;
const TWO_HAND_HINT = /双手|两手/;
const ONE_HAND_HINT = /一只手|另一只手|单手|另一手/;
const TWO_HAND_ACCOUNTING_FIX_HINT = /单手.{0,24}另一|另一只手|明确先单手/;
const ONE_LIMB_LEAVE_HINT = /一只手|另一只手|单手|另一手|那只手/;
const LEAVE_OR_SLIDE_HINT =
  /松开|抽回|滑(下|到|向|过|去)|绕到|探去|探下|放下|离开|挪开|移开/;
const POSE_SHIFT_HINT = /低头|抬头|侧过|转过|调整姿势|换了个姿势/;
const CONCURRENT_OCCUPANCY_HINT =
  /同时|一边.{0,16}一边|仍(然)?(环|扶|按|握|揽)|并未松开|没有松开|还(环|扶|按|握)着/;

function looksLikeTwoHandOccupancyConflictItem(text: string): boolean {
  if (!TWO_HAND_HINT.test(text)) {
    return false;
  }
  const occupancy =
    ACTION_SPACE_OCCUPANCY_HINT.test(text) || /冲突|矛盾|占用/.test(text);
  if (!occupancy) {
    return false;
  }
  return ONE_HAND_HINT.test(text) || TWO_HAND_ACCOUNTING_FIX_HINT.test(text);
}

function findQuotedSpanIndex(sourceText: string, quote: string, fromIndex = 0): number {
  const exact = sourceText.indexOf(quote, fromIndex);
  if (exact >= 0) {
    return exact;
  }
  const compact = quote.replace(/[，。；、\s]/g, '');
  if (compact.length < 6) {
    return -1;
  }
  const head = compact.slice(0, Math.min(12, compact.length));
  return sourceText.indexOf(head, fromIndex);
}

function findOccupancyWindow(
  sourceText: string,
  itemText: string
): { start: number; end: number } | null {
  const quotes = extractQuotedFeatureSpans(itemText).filter((quote) => quote.length >= 4);
  if (quotes.length >= 2) {
    const first = findQuotedSpanIndex(sourceText, quotes[0]!);
    const second = findQuotedSpanIndex(
      sourceText,
      quotes[1]!,
      first >= 0 ? first + 1 : 0
    );
    if (first >= 0 && second > first) {
      return { start: first, end: Math.min(sourceText.length, second + quotes[1]!.length) };
    }
  }
  const twoHand = sourceText.search(/双手|两手/);
  if (twoHand < 0) {
    return null;
  }
  const rest = sourceText.slice(twoHand + 2);
  const leaveMatch = rest.match(
    /一只手|另一只手|单手|另一手|那只手|滑(下|到|向|过|去)|绕到|探去|探下/
  );
  if (!leaveMatch || leaveMatch.index === undefined) {
    return null;
  }
  return {
    start: twoHand,
    end: twoHand + 2 + leaveMatch.index + leaveMatch[0].length,
  };
}

function sourceShowsSequentialLimbRelease(sourceText: string, itemText: string): boolean {
  const window = findOccupancyWindow(sourceText, itemText);
  if (!window) {
    return false;
  }
  const slice = sourceText.slice(window.start, window.end);
  if (CONCURRENT_OCCUPANCY_HINT.test(slice)) {
    return false;
  }
  const hasLeave =
    ONE_LIMB_LEAVE_HINT.test(slice) ||
    LEAVE_OR_SLIDE_HINT.test(slice) ||
    POSE_SHIFT_HINT.test(slice);
  if (!hasLeave) {
    return false;
  }
  return /[。！？\n]/.test(slice) || POSE_SHIFT_HINT.test(slice) || LEAVE_OR_SLIDE_HINT.test(slice);
}

/**
 * 丢掉把先后动作或同一只手滑动叠成「双手占用冲突」的误伤。
 */
export function dropFalseSequentialOccupancyItems(
  outline: { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] },
  sourceText: string
): { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] } {
  if (!sourceText.trim()) {
    return outline;
  }
  const keep = (item: PipelineOutlineItem): boolean => {
    if (!looksLikeTwoHandOccupancyConflictItem(item.text)) {
      return true;
    }
    return !sourceShowsSequentialLimbRelease(sourceText, item.text);
  };
  return {
    required: outline.required.filter(keep),
    suggested: outline.suggested.filter(keep),
  };
}

/**
 * 丢掉「人物卡未记载」但参考块里已经写明的一致性误伤（如梨涡、籍贯在角色卡中）。
 */
export function dropFalseMissingCardConsistencyItems(
  outline: { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] },
  personaBlock: string
): { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] } {
  if (!personaBlock.trim()) {
    return outline;
  }
  const keep = (item: PipelineOutlineItem): boolean => {
    if (!COMPLIANCE_MISSING_CARD_HINT.test(item.text)) {
      return true;
    }
    const quotes = extractQuotedFeatureSpans(item.text);
    if (quotes.some((quote) => quoteSupportedByPersonaBlock(quote, personaBlock))) {
      return false;
    }
    if (item.text.includes('梨涡') && personaBlock.includes('梨涡')) {
      return false;
    }
    if (/籍贯|重庆/.test(item.text) && personaBlock.includes('重庆')) {
      return false;
    }
    return true;
  };
  return {
    required: outline.required.filter(keep),
    suggested: outline.suggested.filter(keep),
  };
}

export function finalizeComplianceOutline(
  outline: { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] },
  sourceText: string,
  rules: ContentSafetyRule[],
  scanEnabled: boolean,
  personaBlock = ''
): { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] } {
  const filtered = dropFalseSequentialOccupancyItems(
    dropFalseMissingCardConsistencyItems(
      dropUnmatchedForbiddenOutlineItems(
        outline,
        sourceText,
        listProjectHighRiskForbiddenTerms(rules)
      ),
      personaBlock
    ),
    sourceText
  );
  return capComplianceOutlineItems(
    sanitizeSensoryOutlineWithContentScan(filtered, rules, scanEnabled)
  );
}

export function makeComplianceTraceId(suffix: string): string {
  return `compliance-${suffix}-${randomUUID().slice(0, 8)}`;
}

export function buildForbiddenWordsSummary(rules: ContentSafetyRule[]): string {
  const patterns = rules
    .filter((rule) => rule.severity === 'high' || rule.action === 'block')
    .map((rule) => rule.pattern)
    .filter(Boolean)
    .slice(0, 80);
  if (!patterns.length) {
    return '（无项目级高危禁用词配置）';
  }
  return patterns.join('、');
}

export function buildCompliancePreScanSummary(issues: PipelineRuleIssue[]): string {
  if (!issues.length) {
    return '（预扫未发现硬规则命中）';
  }
  return issues
    .slice(0, 50)
    .map((issue) => `- [${issue.category}] ${issue.text}（${issue.fixStrategy}）`)
    .join('\n');
}

/** 角色卡按匹配全量注入；99999 只挡住极端超大文档，不当日常上限 */
export const COMPLIANCE_PERSONA_CARD_MAX_CHARS = 99999;

export type CompliancePersonaCardDoc = {
  personaId?: string | null;
  title: string;
  content: string;
};

function clipPersonaCardContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= COMPLIANCE_PERSONA_CARD_MAX_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, COMPLIANCE_PERSONA_CARD_MAX_CHARS)}\n…（角色卡过长，已截断）`;
}

function matchPersonaCard(
  persona: { id?: string; name: string },
  cards: CompliancePersonaCardDoc[]
): CompliancePersonaCardDoc | undefined {
  if (persona.id) {
    const byId = cards.find((card) => card.personaId === persona.id);
    if (byId?.content.trim()) {
      return byId;
    }
  }
  return cards.find((card) => extractCardDisplayName(card.title) === persona.name);
}

export function resolveCompliancePersonaNames(
  personas: Array<{ name: string; status: string }>,
  sourceText: string,
  selectedPersonaNames?: string[]
): string[] | undefined {
  const appearing = personas
    .filter((persona) => persona.name && sourceText.includes(persona.name))
    .map((persona) => persona.name);
  const selected = (selectedPersonaNames ?? []).map((name) => name.trim()).filter(Boolean);
  const names = [...new Set([...appearing, ...selected])];
  return names.length > 0 ? names : undefined;
}

/** 合规用人设：正文出场或检索勾选的角色含草稿；无名单时回退已发布人物。 */
function filterCompliancePersonas<T extends { name: string; status: string }>(
  personas: T[],
  names?: string[]
): T[] {
  const selected = (names ?? []).map((name) => name.trim()).filter(Boolean);
  if (selected.length === 0) {
    return filterPipelinePersonas(personas);
  }
  const wanted = new Set(selected);
  return personas.filter((persona) => wanted.has(persona.name));
}

export function buildCompliancePersonaBlock(
  personas: Array<{ id?: string; name: string; profile: string; state: string; status: string }>,
  selectedPersonaNames?: string[],
  options?: { cards?: CompliancePersonaCardDoc[]; sourceText?: string }
): string {
  const names = options?.sourceText
    ? resolveCompliancePersonaNames(personas, options.sourceText, selectedPersonaNames)
    : selectedPersonaNames;
  const selected = filterCompliancePersonas(personas, names);
  const usedNames = new Set(selected.map((persona) => persona.name));
  const cards = options?.cards ?? [];
  const blocks = selected.map((persona) => {
    const card = matchPersonaCard(persona, cards);
    const lines = [`${persona.name}：${persona.profile}`];
    if (card?.content.trim()) {
      lines.push(`角色卡《${card.title}》`, clipPersonaCardContent(card.content));
    }
    lines.push(`状态：${persona.state}`);
    return lines.join('\n');
  });
  if (options?.sourceText) {
    for (const card of cards) {
      const displayName = extractCardDisplayName(card.title);
      if (!displayName || usedNames.has(displayName) || !options.sourceText.includes(displayName)) {
        continue;
      }
      if (!card.content.trim()) {
        continue;
      }
      usedNames.add(displayName);
      blocks.push(
        `${displayName}：\n角色卡《${card.title}》\n${clipPersonaCardContent(card.content)}`
      );
    }
  }
  return blocks.join('\n\n');
}

export function buildComplianceOutlineUserPrompt(input: {
  sourceText: string;
  forbiddenWordsSummary: string;
  preScanSummary?: string;
  personaBlock?: string;
}): string {
  const blocks = [
    '【输出要求】',
    COMPLIANCE_OUTLINE_JSON_FORMAT,
    `【项目高危禁用词参考】\n${input.forbiddenWordsSummary}`,
  ];
  if (input.personaBlock?.trim()) {
    blocks.push(
      [
        '【人物卡参考】',
        input.personaBlock.trim(),
        '（须核对正文与人设、称谓、关系、外观是否一致；以本参考全文及关联角色卡为准。已记载的外观/籍贯不得标「未记载」。）',
      ].join('\n')
    );
  }
  if (input.preScanSummary?.trim()) {
    blocks.push(`【硬规则预扫命中摘要】\n${input.preScanSummary.trim()}`);
  }
  blocks.push(`<chapter-original>\n${input.sourceText}\n</chapter-original>`);
  return blocks.join('\n\n');
}

export function buildComplianceRewriteUserPrompt(input: {
  sourceText: string;
  outline: PipelineOutlineItem[];
  forbiddenWordsSummary: string;
  personaBlock?: string;
}): string {
  const outlineJson = JSON.stringify({ items: input.outline }, null, 2);
  const blocks = [`【项目高危禁用词参考】\n${input.forbiddenWordsSummary}`];
  if (input.personaBlock?.trim()) {
    blocks.push(`【人物卡参考】\n${input.personaBlock.trim()}`);
  }
  blocks.push(
    `<compliance-outline>\n${outlineJson}\n</compliance-outline>`,
    `<chapter-original>\n${input.sourceText}\n</chapter-original>`
  );
  return blocks.join('\n\n');
}

export function buildComplianceOutlineGateUserPrompt(input: {
  baseUserPrompt: string;
  currentOutline: { required: PipelineOutlineItem[]; suggested: PipelineOutlineItem[] };
  mode: ComplianceOutlineReviseMode;
  userFeedback?: string;
}): string {
  const blocks = [
    input.baseUserPrompt,
    `<current-outline>\n${JSON.stringify(input.currentOutline, null, 2)}\n</current-outline>`,
  ];
  if (input.userFeedback?.trim()) {
    blocks.push(`<user-feedback>\n${input.userFeedback.trim()}\n</user-feedback>`);
  }
  if (input.mode === 'recheck') {
    blocks.push(
      [
        '【补充说明】',
        '请按 system 中与首次生成相同的标准重新检验正文并输出 JSON 大纲。',
        '仅输出 JSON（required + suggested），不要前言或报告体。',
      ].join('\n')
    );
  } else {
    blocks.push(
      [
        '【补充说明】',
        '在保持相同 JSON 格式前提下，优先落实 <user-feedback>。',
        '仅输出 JSON（required + suggested）。',
      ].join('\n')
    );
  }
  return blocks.filter(Boolean).join('\n\n');
}

export function createEmptyComplianceOutlineState(): ComplianceOutlineState {
  return {
    required: [],
    suggested: [],
    userConfirmed: false,
    revisionRound: 0,
    revisionHistory: [],
  };
}

export function serializeComplianceSessionView(session: ComplianceCheckSession) {
  return {
    sessionId: session.sessionId,
    projectId: session.projectId,
    chapterNo: session.chapterNo,
    status: session.status,
    sourceText: session.sourceText,
    selectedPersonaNames: session.selectedPersonaNames,
    outline: session.outline,
    versionText: session.versionText,
    preScanIssues: session.preScanIssues,
    residualIssues: session.residualIssues,
    qualityStatus: session.qualityStatus,
    traceIds: session.traceIds,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

export const COMPLIANCE_GENERATION_CONTEXT = {
  omitProjectSystemPrompt: true,
} as const;
