import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAPTER_COMPLIANCE_OUTLINE_FORBIDDEN_WORDS,
  CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT,
  CHAPTER_COMPLIANCE_REWRITE_SYSTEM_PROMPT,
  buildComplianceOutlineUserPrompt,
  buildCompliancePersonaBlock,
  buildCompliancePreScanSummary,
  buildForbiddenWordsSummary,
    capComplianceOutlineItems,
    dropFalseMissingCardConsistencyItems,
    dropFalseSequentialOccupancyItems,
    dropUnmatchedForbiddenOutlineItems,
    listComplianceForbiddenTerms,
} from './compliance-check.util';

describe('compliance-check.util', () => {
  it('warehouse outline prompt checks action/space and baked-in forbidden words', () => {
    assert.match(CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT, /动作合理性、空间合理性/);
    assert.match(CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT, /action_space/);
    assert.match(CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT, /【禁用词】/);
    assert.match(CHAPTER_COMPLIANCE_OUTLINE_FORBIDDEN_WORDS, /阴道壁/);
    assert.match(CHAPTER_COMPLIANCE_OUTLINE_FORBIDDEN_WORDS, /大屌/);
    assert.match(CHAPTER_COMPLIANCE_OUTLINE_FORBIDDEN_WORDS, /活塞式/);
    assert.ok(CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT.includes(CHAPTER_COMPLIANCE_OUTLINE_FORBIDDEN_WORDS));
    assert.match(CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT, /最多 12 条/);
    assert.match(CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT, /情色、性爱、身体描写本身不是违规/);
    assert.match(CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT, /需完整匹配，比如「子宫」为非禁用词/);
    assert.doesNotMatch(CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT, /擦边表述/);
    assert.doesNotMatch(CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT, /平台禁用表达/);
    assert.doesNotMatch(CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT, /拆字、谐音硬凑/);
    assert.match(CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT, /占用以时间顺序的最新状态为准/);
    assert.match(CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT, /禁止把先后动作改写成「单手……另一只手……」对账句/);
    assert.match(CHAPTER_COMPLIANCE_OUTLINE_SYSTEM_PROMPT, /不得标「未记载」/);
    assert.match(CHAPTER_COMPLIANCE_REWRITE_SYSTEM_PROMPT, /先后动作保持原文顺序/);
  });

  it('buildComplianceOutlineUserPrompt includes chapter body', () => {
    const prompt = buildComplianceOutlineUserPrompt({
      sourceText: '第一章正文',
      forbiddenWordsSummary: '词A',
    });
    assert.match(prompt, /第一章正文/);
    assert.match(prompt, /词A/);
    assert.match(prompt, /required/);
    assert.match(prompt, /最多 12 条/);
    assert.match(prompt, /禁止按段落抄写/);
    assert.match(prompt, /情色\/性爱描写本身不是违规/);
    assert.match(prompt, /「子宫」不是禁用词/);
    assert.match(prompt, /已记载的外观\/籍贯不得标「未记载」/);
    assert.match(prompt, /先后动作、一只手离开后再做，一律不标/);
    assert.doesNotMatch(prompt, /平台禁用表达/);
  });

  it('capComplianceOutlineItems keeps the first 12 required and 8 suggested', () => {
    const required = Array.from({ length: 15 }, (_, index) => ({
      id: `r${index + 1}`,
      text: `必改${index + 1}`,
      priority: 'required' as const,
    }));
    const suggested = Array.from({ length: 10 }, (_, index) => ({
      id: `s${index + 1}`,
      text: `建议${index + 1}`,
      priority: 'suggested' as const,
    }));
    const capped = capComplianceOutlineItems({ required, suggested });
    assert.equal(capped.required.length, 12);
    assert.equal(capped.suggested.length, 8);
    assert.equal(capped.required[11]?.id, 'r12');
    assert.equal(capped.suggested[7]?.id, 's8');
  });

  it('buildForbiddenWordsSummary lists high severity patterns', () => {
    const summary = buildForbiddenWordsSummary([
      { ruleId: 'r1', pattern: '违禁', severity: 'high', action: 'block', type: 'keyword' },
      { ruleId: 'r2', pattern: '低风险', severity: 'low', action: 'mark', type: 'keyword' },
    ]);
    assert.match(summary, /违禁/);
    assert.doesNotMatch(summary, /低风险/);
  });

  it('buildComplianceOutlineUserPrompt includes pre-scan summary when provided', () => {
    const prompt = buildComplianceOutlineUserPrompt({
      sourceText: '第一章正文',
      forbiddenWordsSummary: '词A',
      preScanSummary: '- [forbidden_word] 违禁',
    });
    assert.match(prompt, /硬规则预扫命中摘要/);
    assert.match(prompt, /违禁/);
  });

  it('buildComplianceOutlineUserPrompt includes persona block when provided', () => {
    const prompt = buildComplianceOutlineUserPrompt({
      sourceText: '第一章正文',
      forbiddenWordsSummary: '词A',
      personaBlock: '林默：黑发少年\n状态：冷静',
    });
    assert.match(prompt, /【人物卡参考】/);
    assert.match(prompt, /林默/);
  });

  it('buildCompliancePersonaBlock keeps published personas when no selection', () => {
    const block = buildCompliancePersonaBlock([
      { name: '甲', profile: '设定A', state: '平静', status: 'published' },
      { name: '乙', profile: '设定B', state: '草稿', status: 'draft' },
    ]);
    assert.match(block, /甲/);
    assert.doesNotMatch(block, /乙/);
  });

  it('listComplianceForbiddenTerms includes 子宫腔 but not 子宫', () => {
    const terms = listComplianceForbiddenTerms();
    assert.ok(terms.includes('子宫腔'));
    assert.ok(terms.includes('宫颈口'));
    assert.equal(terms.includes('子宫'), false);
  });

  it('dropUnmatchedForbiddenOutlineItems removes 子宫 false positives', () => {
    const sourceText = '精液灌入子宫，小腹发胀。他握住她的腰。';
    const filtered = dropUnmatchedForbiddenOutlineItems(
      {
        required: [
          {
            id: 'r1',
            text: '【forbidden_expression】正文出现解剖词「子宫」，须替换为非清单用语。',
            priority: 'required',
          },
          {
            id: 'r2',
            text: '【action_space】双手握住腰后又去撑床，第三只手来源不明。',
            priority: 'required',
          },
        ],
        suggested: [
          {
            id: 's1',
            text: '【consistency】称谓与人物卡不一致。',
            priority: 'suggested',
          },
        ],
      },
      sourceText
    );
    assert.equal(filtered.required.some((item) => item.id === 'r1'), false);
    assert.equal(filtered.required.some((item) => item.id === 'r2'), true);
    assert.equal(filtered.suggested.some((item) => item.id === 's1'), true);
  });

  it('dropUnmatchedForbiddenOutlineItems keeps complete listed hits such as 子宫腔', () => {
    const sourceText = '精液灌满子宫腔，小腹发胀。';
    const filtered = dropUnmatchedForbiddenOutlineItems(
      {
        required: [
          {
            id: 'r1',
            text: '【forbidden_expression】正文出现解剖词「子宫腔」，替换该词即可。',
            priority: 'required',
          },
        ],
        suggested: [],
      },
      sourceText
    );
    assert.equal(filtered.required.length, 1);
    assert.equal(filtered.required[0]?.id, 'r1');
  });

  it('dropUnmatchedForbiddenOutlineItems keeps project high-risk terms', () => {
    const filtered = dropUnmatchedForbiddenOutlineItems(
      {
        required: [
          {
            id: 'r1',
            text: '【forbidden_expression】正文出现项目高危禁用词「自定义禁词」。',
            priority: 'required',
          },
        ],
        suggested: [],
      },
      '这里写了自定义禁词。',
      ['自定义禁词']
    );
    assert.equal(filtered.required.length, 1);
  });

  it('dropUnmatchedForbiddenOutlineItems drops unlisted expansions such as 龟头', () => {
    const filtered = dropUnmatchedForbiddenOutlineItems(
      {
        required: [
          {
            id: 'r1',
            text: '【forbidden_expression】解剖词「龟头」须替换。',
            priority: 'required',
          },
        ],
        suggested: [],
      },
      '他的龟头抵着入口。'
    );
    assert.equal(filtered.required.length, 0);
  });

  it('buildCompliancePersonaBlock filters by selected persona names', () => {
    const personas = [
      { name: '甲', profile: '设定A', state: '平静', status: 'published' },
      { name: '乙', profile: '设定B', state: '活跃', status: 'published' },
    ];
    const block = buildCompliancePersonaBlock(personas, ['乙']);
    assert.doesNotMatch(block, /甲/);
    assert.match(block, /乙/);
  });

  it('buildCompliancePersonaBlock injects linked persona card content', () => {
    const block = buildCompliancePersonaBlock(
      [{ id: 'p-tian', name: '田曦薇', profile: '女主', state: '平静', status: 'published' }],
      undefined,
      {
        sourceText: '田曦薇笑起来，右侧脸颊那个标志性的梨涡陷进去。重庆妹子那种利落劲儿。',
        cards: [
          {
            personaId: 'p-tian',
            title: '田曦薇角色卡',
            content: '右侧单梨涡。重庆人。嘴快带刺。',
          },
        ],
      }
    );
    assert.match(block, /角色卡《田曦薇角色卡》/);
    assert.match(block, /右侧单梨涡/);
    assert.match(block, /重庆人/);
  });

  it('buildCompliancePersonaBlock injects matched persona cards without the 16k cap', () => {
    const body = '梨涡设定。'.repeat(4000);
    assert.ok(body.length > 16000);
    const block = buildCompliancePersonaBlock(
      [{ id: 'p-tian', name: '田曦薇', profile: '女主', state: '平静', status: 'published' }],
      ['田曦薇'],
      {
        cards: [{ personaId: 'p-tian', title: '田曦薇角色卡', content: body }],
      }
    );
    assert.match(block, /梨涡设定/);
    assert.doesNotMatch(block, /角色卡过长，已截断/);
    assert.ok(block.includes(body.trim()));
  });

  it('buildCompliancePersonaBlock includes appearing personas even if retrieval selected another', () => {
    const block = buildCompliancePersonaBlock(
      [
        { name: '林默', profile: '男主', state: '冷静', status: 'published' },
        { name: '田曦薇', profile: '女主', state: '平静', status: 'published' },
      ],
      ['林默'],
      { sourceText: '田曦薇看着林默。' }
    );
    assert.match(block, /林默/);
    assert.match(block, /田曦薇/);
  });

  it('buildCompliancePersonaBlock injects draft appearing persona via title-matched card', () => {
    const block = buildCompliancePersonaBlock(
      [
        {
          id: 'p-tian',
          name: '田曦薇',
          profile: '由导入小说自动创建，请补充详细设定',
          state: '平静',
          status: 'draft',
        },
      ],
      ['林默'],
      {
        sourceText: '田曦薇笑起来，右侧脸颊那个标志性的梨涡陷进去。',
        cards: [
          {
            personaId: null,
            title: '田曦薇',
            content: '右侧单梨涡。重庆人。',
          },
        ],
      }
    );
    assert.match(block, /角色卡《田曦薇》/);
    assert.match(block, /右侧单梨涡/);
    assert.match(block, /重庆人/);
  });

  it('dropFalseMissingCardConsistencyItems removes 梨涡 and 重庆 false missing-card claims', () => {
    const personaBlock = '田曦薇：\n角色卡《田曦薇角色卡》\n右侧单梨涡。重庆人。';
    const filtered = dropFalseMissingCardConsistencyItems(
      {
        required: [],
        suggested: [
          {
            id: 's1',
            text: '一致性建议：正文中田曦薇「右侧脸颊那个标志性的梨涡」反复出现，人物卡未记载此特征。',
            priority: 'suggested',
          },
          {
            id: 's2',
            text: '一致性建议：正文提及「重庆妹子那种利落劲儿」，人物卡未记载田曦薇籍贯。',
            priority: 'suggested',
          },
          {
            id: 's3',
            text: '一致性建议：正文写她有「绿色竖瞳」，人物卡未记载。',
            priority: 'suggested',
          },
        ],
      },
      personaBlock
    );
    assert.equal(filtered.suggested.some((item) => item.id === 's1'), false);
    assert.equal(filtered.suggested.some((item) => item.id === 's2'), false);
    assert.equal(filtered.suggested.some((item) => item.id === 's3'), true);
  });

  it('dropFalseSequentialOccupancyItems drops sequential two-hand then one-hand false conflicts', () => {
    const sourceText = [
      '她的双手环住林默的脖子，身体微微前倾，饱满的胸脯压上他的胸膛。',
      '田曦薇低头，调整姿势。一只手向下探去，指尖触到那根粗硬滚烫的肉棒时，她小腹不自觉收紧了一下。',
    ].join('\n');
    const filtered = dropFalseSequentialOccupancyItems(
      {
        required: [
          {
            id: 'r1',
            text: '动作/空间矛盾：客厅骑乘段落中，田曦薇「双手环住林默的脖子，身体微微前倾」的同时「一只手向下探去，指尖触到那根粗硬滚烫的肉棒」——双手环颈与单手向下探取存在占用冲突。修改方向：明确先单手扶入再双手环颈，或改为单手环颈、另一手扶入。',
            priority: 'required',
          },
        ],
        suggested: [],
      },
      sourceText
    );
    assert.equal(filtered.required.length, 0);
  });

  it('dropFalseSequentialOccupancyItems drops same-hand slide treated as two hands', () => {
    const filtered = dropFalseSequentialOccupancyItems(
      {
        required: [
          {
            id: 'r1',
            text: '动作/空间矛盾：「双手扶着他的腰」后又「绕到前面抓住」存在占用冲突。修改方向：改为单手扶腰，另一只手绕到前面。',
            priority: 'required',
          },
        ],
        suggested: [],
      },
      '她双手扶着他的腰。手滑下去，绕到前面抓住。'
    );
    assert.equal(filtered.required.length, 0);
  });

  it('dropFalseSequentialOccupancyItems keeps true simultaneous occupancy', () => {
    const filtered = dropFalseSequentialOccupancyItems(
      {
        required: [
          {
            id: 'r1',
            text: '动作/空间矛盾：「双手环住林默的脖子」同时「一只手向下探去」占用冲突。',
            priority: 'required',
          },
          {
            id: 'r2',
            text: '【action_space】双手按住床沿后又去撑墙，第三只手来源不明。',
            priority: 'required',
          },
        ],
        suggested: [],
      },
      '她双手环住林默的脖子，同时一只手向下探去。她双手按住床沿，又去撑墙。'
    );
    assert.equal(filtered.required.some((item) => item.id === 'r1'), true);
    assert.equal(filtered.required.some((item) => item.id === 'r2'), true);
  });
});
