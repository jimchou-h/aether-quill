<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { DocumentItem, PersonaItem, RelationEventItem } from '../../services/api';
import { buildPersonaTimeline, getPersonaRelationEvents } from '../../utils/personaGraph';
import { resolvePersonaStatusForView } from '../../utils/personaChapterStatus';

const props = defineProps<{
  projectId: string;
  personas: PersonaItem[];
  relationEvents: RelationEventItem[];
  documents: DocumentItem[];
  selectedPersonaId: string | null;
  statusAsOfChapterNo?: number | null;
}>();

const emit = defineEmits<{
  selectPersona: [personaId: string];
}>();

const router = useRouter();

const selectedPersona = computed(
  () =>
    props.personas.find((item) => item.id === props.selectedPersonaId) || props.personas[0] || null
);

const relatedEvents = computed(() => {
  if (!selectedPersona.value) {
    return [];
  }
  return getPersonaRelationEvents(selectedPersona.value, props.relationEvents);
});

const timeline = computed(() => {
  if (!selectedPersona.value) {
    return [];
  }
  return buildPersonaTimeline(selectedPersona.value, props.relationEvents);
});

const linkedPersonaCard = computed(() => {
  if (!selectedPersona.value) {
    return null;
  }
  return (
    props.documents.find(
      (doc) =>
        (doc.docType ?? 'other') === 'persona_card' && doc.personaId === selectedPersona.value!.id
    ) ?? null
  );
});

const statusViewMode = computed(() =>
  props.statusAsOfChapterNo == null
    ? ('latest' as const)
    : { asOfChapterNo: props.statusAsOfChapterNo }
);

function personaStatusText(persona: PersonaItem): string {
  return resolvePersonaStatusForView(persona, statusViewMode.value).text;
}

const linkedDocuments = computed(() => {
  if (!selectedPersona.value) {
    return [];
  }
  const personaId = selectedPersona.value.id;
  const keyword = selectedPersona.value.name.trim();
  return props.documents.filter((doc) => {
    if ((doc.docType ?? 'other') === 'persona_card' && doc.personaId === personaId) {
      return true;
    }
    if (!keyword) {
      return false;
    }
    return doc.title.includes(keyword) || doc.content.includes(keyword);
  });
});

function jumpToKnowledgeDoc(docId: string) {
  void router.push({
    name: 'knowledge',
    params: { id: props.projectId },
    query: { docId },
  });
}

function formatAppearance(persona: PersonaItem) {
  const chapters = persona.appearedChapterNos ?? [];
  if (chapters.length === 0) {
    return '暂无出场记录';
  }
  return `${chapters.join(', ')} · 共 ${chapters.length} 章`;
}

function jumpToPersona(personaId: string, fallbackName?: string) {
  if (personaId) {
    emit('selectPersona', personaId);
    return;
  }
  const matched = props.personas.find((persona) => persona.name === fallbackName);
  if (matched) {
    emit('selectPersona', matched.id);
  }
}

function jumpToChapter(chapterNo: number) {
  void router.push({
    name: 'chapters',
    params: { id: props.projectId },
    query: { chapterNo: String(chapterNo) },
  });
}
</script>

<template>
  <div class="persona-card-layout">
    <aside class="persona-list">
      <button
        v-for="persona in personas"
        :key="persona.id"
        type="button"
        class="persona-list-item"
        :class="{ active: selectedPersona?.id === persona.id }"
        @click="jumpToPersona(persona.id)"
      >
        <strong>{{ persona.name }}</strong>
        <span>{{ personaStatusText(persona) }}</span>
      </button>
    </aside>

    <article v-if="selectedPersona" class="persona-detail-card">
      <header class="card-header">
        <h3>{{ selectedPersona.name }}</h3>
        <p>
          状态：{{ selectedPersona.status === 'published' ? '已发布' : '草稿' }} · 人物状态：{{
            personaStatusText(selectedPersona)
          }}
        </p>
        <p>出场章节：{{ formatAppearance(selectedPersona) }}</p>
        <p>
          最后出场：{{
            selectedPersona.lastAppearedChapterNo
              ? `第${selectedPersona.lastAppearedChapterNo}章`
              : '暂无'
          }}
        </p>
      </header>

      <section class="card-section">
        <h4>人物简介</h4>
        <p class="profile-text">{{ selectedPersona.profile || '（暂无简介）' }}</p>
      </section>

      <section class="card-section">
        <h4>关联静态设定卡</h4>
        <template v-if="linkedPersonaCard">
          <p class="meta">
            <button
              type="button"
              class="link-button"
              @click="jumpToKnowledgeDoc(linkedPersonaCard.id)"
            >
              {{ linkedPersonaCard.title }}
            </button>
            · 只读预览（编辑请前往知识库）
          </p>
          <pre class="card-preview">{{ linkedPersonaCard.content?.slice(0, 1200) || '（无内容）' }}</pre>
        </template>
        <p v-else class="empty-hint">
          尚未关联知识库角色卡。请在知识库创建/编辑 persona_card 并选择本人物。
        </p>
      </section>

      <section class="card-section">
        <h4>关系网</h4>
        <ul v-if="relatedEvents.length > 0" class="relation-list">
          <li v-for="event in relatedEvents" :key="event.id">
            <button
              type="button"
              class="link-button"
              @click="jumpToPersona(event.counterpartyPersonaId || '', event.counterparty)"
            >
              {{ event.counterparty }}
            </button>
            <span> — {{ event.summary }}</span>
            <span v-if="event.chapterNo" class="meta">（第{{ event.chapterNo }}章）</span>
          </li>
        </ul>
        <p v-else class="empty-hint">暂无关联关系事件</p>
      </section>

      <section class="card-section">
        <h4>时间线</h4>
        <ul v-if="timeline.length > 0" class="timeline-list">
          <li v-for="(item, index) in timeline" :key="`${item.chapterNo}-${index}`">
            <button type="button" class="link-button" @click="jumpToChapter(item.chapterNo)">
              第{{ item.chapterNo }}章
            </button>
            <span> — {{ item.label.replace(/^第\d+章 · /, '') }}</span>
          </li>
        </ul>
        <p v-else class="empty-hint">暂无时间线记录</p>
      </section>

      <section class="card-section">
        <h4>关联文档（{{ linkedDocuments.length }} 篇）</h4>
        <ul v-if="linkedDocuments.length > 0" class="doc-list">
          <li v-for="doc in linkedDocuments" :key="doc.id">
            <button type="button" class="link-button" @click="jumpToKnowledgeDoc(doc.id)">
              {{ doc.title }}
            </button>
            <span v-if="(doc.docType ?? 'other') === 'persona_card'" class="meta"> · 角色卡</span>
          </li>
        </ul>
        <p v-else class="empty-hint">暂无关联角色卡或标题/正文命中的文档</p>
      </section>
    </article>

    <p v-else class="empty-hint">请选择人物查看卡片详情</p>
  </div>
</template>

<style scoped>
.persona-card-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 1rem;
  align-items: start;
}

.persona-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.persona-list-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--aq-border);
  border-radius: var(--aq-radius-sm);
  background: var(--aq-surface);
  cursor: pointer;
  text-align: left;
  transition: border-color var(--aq-transition-fast), background var(--aq-transition-fast);
}

.persona-list-item.active {
  border-color: var(--aq-primary);
  background: var(--aq-primary-soft);
}

.persona-detail-card {
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 1.25rem;
  background: #fff;
}

.card-header h3 {
  margin: 0 0 0.35rem;
}

.card-header p {
  margin: 0.2rem 0;
  color: #4b5563;
}

.card-section + .card-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #f3f4f6;
}

.card-section h4 {
  margin: 0 0 0.5rem;
}

.relation-list,
.timeline-list,
.doc-list {
  margin: 0;
  padding-left: 1.1rem;
}

.relation-list li + li,
.timeline-list li + li,
.doc-list li + li {
  margin-top: 0.35rem;
}

.link-button {
  border: none;
  background: none;
  color: var(--aq-primary);
  cursor: pointer;
  padding: 0;
  font: inherit;
}

.meta {
  color: #6b7280;
}

.empty-hint {
  color: #6b7280;
  margin: 0;
}

.profile-text {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.55;
  color: #374151;
}

.card-preview {
  margin: 0.5rem 0 0;
  padding: 0.75rem;
  max-height: 16rem;
  overflow: auto;
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 0.85rem;
  line-height: 1.5;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}
</style>
