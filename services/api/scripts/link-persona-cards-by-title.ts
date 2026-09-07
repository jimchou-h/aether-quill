/**
 * AQ-364：按标题预匹配为 persona_card 补全 personaId（不搬内容）
 *
 * 用法（在 services/api 目录）：
 *   pnpm exec tsx scripts/link-persona-cards-by-title.ts --dry-run
 *   pnpm exec tsx scripts/link-persona-cards-by-title.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { decidePersonaCardLink } from '../src/modules/documents/persona-card-link.util';

config({ path: resolve(process.cwd(), '.env') });

const dryRun = process.argv.includes('--dry-run');

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error('缺少 DATABASE_URL');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const cards = await prisma.document.findMany({
      where: { docType: 'persona_card' },
      select: { id: true, projectId: true, title: true, personaId: true },
    });
    const personas = await prisma.persona.findMany({
      select: { id: true, projectId: true, name: true },
    });

    const byProject = new Map<string, Array<{ id: string; name: string }>>();
    for (const p of personas) {
      const list = byProject.get(p.projectId) ?? [];
      list.push({ id: p.id, name: p.name });
      byProject.set(p.projectId, list);
    }

    let linked = 0;
    let ambiguous = 0;
    let orphan = 0;
    let skipped = 0;

    for (const card of cards) {
      if (card.personaId) {
        skipped += 1;
        continue;
      }
      const decision = decidePersonaCardLink(card.title, byProject.get(card.projectId) ?? []);
      if (decision.status === 'linked') {
        linked += 1;
        console.log(`[linked] ${card.title} -> ${decision.personaId} (score=${decision.score})`);
        if (!dryRun) {
          await prisma.document.update({
            where: { id: card.id },
            data: { personaId: decision.personaId },
          });
        }
      } else if (decision.status === 'ambiguous') {
        ambiguous += 1;
        console.log(
          `[ambiguous] ${card.title} candidates=${decision.candidates
            .map((c) => `${c.name}:${c.score}`)
            .join(',')}`
        );
      } else {
        orphan += 1;
        console.log(`[orphan] ${card.title}`);
      }
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          totalCards: cards.length,
          alreadyLinked: skipped,
          linked,
          ambiguous,
          orphan,
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
