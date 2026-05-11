import {
  ConsistencyCheckResult,
  ConsistencyReport,
  ConsistencyLevel,
  ConsistencyContext,
  CharacterProfile,
  TimelineEvent,
  WorldRule,
} from './types';

const ALIVE_PATTERNS = /\b(活着|健在|仍在|幸存|在世)\b/g;
const AGE_CONTRADICTION = /\b(\d+)\s*(岁|年|春秋)\b/g;

export class ConsistencyChecker {
  check(text: string, context?: ConsistencyContext): ConsistencyReport {
    const results: ConsistencyCheckResult[] = [];

    if (context?.characters) {
      results.push(...this.checkCharacters(text, context.characters));
    }

    if (context?.timeline) {
      results.push(...this.checkTimeline(text, context.timeline));
    }

    if (context?.worldRules) {
      results.push(...this.checkWorldRules(text, context.worldRules));
    }

    if (results.length === 0) {
      results.push({
        level: 'pass',
        category: 'world_rule',
        message: '未检测到设定冲突。',
      });
    }

    const overall = this.aggregate(results);

    return {
      overall,
      results,
      checkedAt: new Date().toISOString(),
    };
  }

  private checkCharacters(text: string, characters: CharacterProfile[]): ConsistencyCheckResult[] {
    const results: ConsistencyCheckResult[] = [];

    for (const character of characters) {
      const names = [character.name, ...(character.aliases || [])];
      const namePattern = new RegExp(`(${names.map((n) => this.escapeRegex(n)).join('|')})`, 'g');
      const mentions = text.match(namePattern);

      if (!mentions) continue;

      if (character.status === 'deceased') {
        const aliveMentions = text.match(ALIVE_PATTERNS);
        if (aliveMentions) {
          results.push({
            level: 'block',
            category: 'character',
            message: `角色「${character.name}」状态冲突：该角色已故，但文本中提及「${aliveMentions[0]}」。`,
            locations: [{ text: aliveMentions[0] }],
          });
        }
      }

      if (character.age) {
        const ageMatches = text.match(AGE_CONTRADICTION);
        if (ageMatches) {
          for (const match of ageMatches) {
            const extractedAge = parseInt(match.match(/\d+/)?.[0] || '0', 10);
            const expectedAge = parseInt(character.age.match(/\d+/)?.[0] || '0', 10);
            if (expectedAge > 0 && extractedAge > 0 && Math.abs(extractedAge - expectedAge) > 5) {
              results.push({
                level: 'warn',
                category: 'character',
                message: `角色「${character.name}」年龄设定为 ${character.age}，但文本中提及「${match}」。`,
                detail: `设定年龄：${character.age}，文本年龄：${extractedAge}岁`,
                locations: [{ text: match }],
              });
            }
          }
        }
      }

      if (character.relationships && character.relationships.length > 0) {
        for (const rel of character.relationships) {
          const relText = text.match(
            new RegExp(`${this.escapeRegex(character.name)}.*?${this.escapeRegex(rel.target)}`, 'i')
          );
          if (!relText) continue;

          for (const related of characters) {
            if (related.name === rel.target && related.status === 'deceased') {
              if (text.match(ALIVE_PATTERNS) && text.includes(rel.target)) {
                results.push({
                  level: 'block',
                  category: 'character',
                  message: `角色关系冲突：「${character.name}」与「${rel.target}」的关系（${rel.relation}），但「${rel.target}」已故。`,
                  detail: `${character.name} ${rel.relation} ${rel.target}`,
                });
              }
            }
          }
        }
      }
    }

    return results;
  }

  private checkTimeline(text: string, timeline: TimelineEvent[]): ConsistencyCheckResult[] {
    const results: ConsistencyCheckResult[] = [];

    if (timeline.length < 2) return results;

    const sortedEvents = [...timeline].sort((a, b) => {
      const noA = a.chapterNo || 0;
      const noB = b.chapterNo || 0;
      return noA - noB;
    });

    for (let i = 0; i < sortedEvents.length; i++) {
      const event = sortedEvents[i];

      if (event.chapterNo) {
        const laterMarkers = text.match(
          new RegExp(`${this.escapeRegex(event.label)}.*?(之前|以前)`, 'i')
        );

        if (laterMarkers) {
          results.push({
            level: 'warn',
            category: 'timeline',
            message: `时间线冲突：事件「${event.label}」（第${event.chapterNo}章）被描述为发生在更早的时间点之前。`,
            detail: event.description,
            locations: [{ text: laterMarkers[0] }],
          });
        }
      }
    }

    return results;
  }

  private checkWorldRules(text: string, rules: WorldRule[]): ConsistencyCheckResult[] {
    const results: ConsistencyCheckResult[] = [];

    for (const rule of rules) {
      const keywords = rule.rule
        .split(/[,，\s]+/)
        .filter((w) => w.length > 1)
        .map((w) => this.escapeRegex(w));

      if (keywords.length === 0) continue;

      const violationPattern = new RegExp(`不[能可应](?:${keywords.join('|')})`, 'gi');

      const violations = text.match(violationPattern);
      if (violations) {
        results.push({
          level: 'block',
          category: 'world_rule',
          message: `世界规则冲突：设定要求「${rule.rule}」（${rule.domain}），但文本中存在违规描述。`,
          detail: `违规文本：${violations.join('；')}`,
          locations: violations.map((v) => ({ text: v })),
        });
      }
    }

    return results;
  }

  private aggregate(results: ConsistencyCheckResult[]): ConsistencyLevel {
    if (results.some((r) => r.level === 'block')) return 'block';
    if (results.some((r) => r.level === 'warn')) return 'warn';
    return 'pass';
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
