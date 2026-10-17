import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectsService } from './projects.service';

/**
 * C4（R12）：run 冻结面必须保留来源与分类，并**排除当前章自身来源**、只冻结任务适用样本。
 */
function sample(id: string, sourceChapterNo: number) {
  return {
    id,
    sourceChapterNo,
    sceneType: 'dialogue' as const,
    text: `第${sourceChapterNo}章的参照文字。`.repeat(10),
    createdAt: '2026-10-07',
    updatedAt: '2026-10-07',
  };
}

/** 直接驱动真实实现（不构造 service 依赖容器），只提供本方法读取的最小 shape。 */
function frozen(
  projectId: string,
  userId: string,
  chapterNo: number | undefined,
  samples: unknown[]
) {
  return ProjectsService.prototype.getFrozenReferenceMaterials.call(
    {
      getPersonas() {
        return [];
      },
      getSettings() {
        return { writingStyleSamples: samples };
      },
      documentsService: {
        findAll() {
          return [];
        },
      },
    } as never,
    projectId,
    userId,
    chapterNo as number
  );
}

test('C4 冻结文风样本排除当前章来源，只保留适用样本', () => {
  const samples = [sample('sample-1', 1), sample('sample-2', 2)];
  // 精修第 1 章：只应冻结第 2 章来源的样本
  const forChapterOne = frozen('p1', 'u1', 1, samples);
  assert.deepEqual(
    forChapterOne.filter((item) => item.kind === 'style').map((item) => item.id),
    ['sample-2']
  );
  // 精修第 2 章：只应冻结第 1 章来源的样本
  const forChapterTwo = frozen('p1', 'u1', 2, samples);
  assert.deepEqual(
    forChapterTwo.filter((item) => item.kind === 'style').map((item) => item.id),
    ['sample-1']
  );
});

test('C4 保留文风样本来源与分类，供追溯与续跑复用', () => {
  const materials = frozen('p1', 'u1', 1, [sample('sample-2', 2)]);
  const style = materials.find((item) => item.kind === 'style');
  assert.ok(style, '应冻结适用的文风样本');
  assert.equal(style?.sourceChapterNo, 2);
  assert.equal(style?.sceneType, 'dialogue');
});

test('C4 未提供章节号时不冻结任何文风样本（保守，绝不注入当前章样本）', () => {
  const materials = frozen('p1', 'u1', undefined, [sample('sample-1', 1), sample('sample-2', 2)]);
  assert.deepEqual(
    materials.filter((item) => item.kind === 'style'),
    []
  );
});

test('C4 冻结后修改项目样本不改变已冻结材料（不随当前设置漂移）', () => {
  const samples = [sample('sample-2', 2)];
  const materials = frozen('p1', 'u1', 1, samples);
  // 运行中改动来源文本
  samples[0]!.text = '运行中改动的文本。'.repeat(10);
  assert.match(materials[0]!.text, /第2章的参照文字/);
  assert.doesNotMatch(materials[0]!.text, /运行中改动/);
});
