import { applyLowRiskReplacements, scanContentSafety } from './scan';
import {
  collectUniqueSentenceRangesForHits,
  replaceSentenceInText,
} from './sentence';
import { DEFAULT_CONTENT_SAFETY_RULES } from './rules';
import type {
  ContentSafetyHit,
  ContentSafetyProcessResult,
  ContentSafetyRule,
} from './types';

/** @deprecated 使用 CONTENT_SAFETY_MAX_REWRITE_BATCHES */
export const CONTENT_SAFETY_MAX_REWRITE_ATTEMPTS = 2;

/** 中风险批量改写：最大复扫轮次 */
export const CONTENT_SAFETY_MAX_REWRITE_BATCHES = 3;

/** 每轮最多改写的唯一句子数 */
export const CONTENT_SAFETY_MAX_SENTENCES_PER_BATCH = 30;

export interface ContentSafetyRewriteProgress {
  batch: number;
  batchSize: number;
  indexInBatch: number;
  rewriteAttempts: number;
}

export interface ProcessContentSafetyOptions {
  enabled: boolean;
  rules?: ContentSafetyRule[];
  rewriteSentence?: (sentence: string) => Promise<string>;
  onRewriteAttempt?: (progress: ContentSafetyRewriteProgress) => void;
}

export async function processContentSafety(
  inputText: string,
  options: ProcessContentSafetyOptions
): Promise<ContentSafetyProcessResult> {
  if (!options.enabled) {
    return {
      text: inputText,
      hits: [],
      blocked: false,
      rewriteAttempts: 0,
      scanEnabled: false,
    };
  }

  const rules = options.rules ?? DEFAULT_CONTENT_SAFETY_RULES;
  let text = inputText;
  let rewriteAttempts = 0;
  const collectedHits: ContentSafetyHit[] = [];

  for (let batch = 0; batch <= CONTENT_SAFETY_MAX_REWRITE_BATCHES; batch += 1) {
    const scan = scanContentSafety(text, rules);
    collectedHits.splice(0, collectedHits.length, ...scan.hits);

    if (scan.hasHigh) {
      return {
        text,
        hits: scan.hits,
        blocked: true,
        blockReason: '检测到高风险违禁内容，已阻断保存',
        rewriteAttempts,
        scanEnabled: true,
      };
    }

    text = applyLowRiskReplacements(text, scan.hits, rules);

    const mediumHits = scan.hits.filter((hit) => hit.severity === 'medium');
    if (mediumHits.length === 0) {
      return {
        text,
        hits: scan.hits,
        blocked: false,
        rewriteAttempts,
        scanEnabled: true,
      };
    }

    if (!options.rewriteSentence) {
      return {
        text,
        hits: scan.hits,
        blocked: true,
        blockReason: '检测到中风险内容，但未配置句子改写能力',
        rewriteAttempts,
        scanEnabled: true,
      };
    }

    if (batch >= CONTENT_SAFETY_MAX_REWRITE_BATCHES) {
      return {
        text,
        hits: scan.hits,
        blocked: true,
        blockReason: '中风险句子批量改写后仍未通过内容安全扫描',
        rewriteAttempts,
        scanEnabled: true,
      };
    }

    const sentenceRanges = collectUniqueSentenceRangesForHits(
      text,
      mediumHits.map((hit) => hit.startOffset)
    ).slice(0, CONTENT_SAFETY_MAX_SENTENCES_PER_BATCH);

    if (sentenceRanges.length === 0) {
      return {
        text,
        hits: scan.hits,
        blocked: true,
        blockReason: '无法定位中风险句子边界',
        rewriteAttempts,
        scanEnabled: true,
      };
    }

    const batchNo = batch + 1;
    for (let index = 0; index < sentenceRanges.length; index += 1) {
      const sentenceRange = sentenceRanges[index]!;
      rewriteAttempts += 1;
      options.onRewriteAttempt?.({
        batch: batchNo,
        batchSize: sentenceRanges.length,
        indexInBatch: index + 1,
        rewriteAttempts,
      });

      const rewritten = (await options.rewriteSentence(sentenceRange.sentence)).trim();
      if (!rewritten) {
        return {
          text,
          hits: scan.hits,
          blocked: true,
          blockReason: '中风险句子改写失败',
          rewriteAttempts,
          scanEnabled: true,
        };
      }

      text = replaceSentenceInText(text, sentenceRange, rewritten);
    }
  }

  return {
    text,
    hits: collectedHits,
    blocked: false,
    rewriteAttempts,
    scanEnabled: true,
  };
}
