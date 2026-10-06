<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import {
  apiClient,
  type EventCardItem,
  type EventCardKind,
  type EventCardStatus,
} from '../services/api';
import { presentErrorFromCaught, presentSuccess } from '../utils/pageFeedback';

const route = useRoute();
const projectId = computed(() => String(route.params.id || ''));

const cards = ref<EventCardItem[]>([]);
const loading = shallowRef(false);
const extracting = shallowRef(false);
const errorMessage = shallowRef('');
const extractChapterNo = shallowRef(1);
const editingId = shallowRef<string | null>(null);
const editBeat = shallowRef('');
const editStatus = shallowRef<EventCardStatus>('fact');

const kindLabel: Record<EventCardKind, string> = {
  foreshadow: '伏笔',
  relation: '关系',
  ability: '能力',
  promise: '承诺',
  object: '物件',
  other: '其它',
};

async function loadCards() {
  loading.value = true;
  errorMessage.value = '';
  try {
    cards.value = await apiClient.getEventCards(projectId.value);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载事件卡失败');
  } finally {
    loading.value = false;
  }
}

async function extractChapter() {
  if (extractChapterNo.value < 1) {
    return;
  }
  extracting.value = true;
  errorMessage.value = '';
  try {
    await apiClient.generateChapterEventCards(projectId.value, extractChapterNo.value);
    presentSuccess(`第 ${extractChapterNo.value} 章事件卡已更新`);
    await loadCards();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '抽取事件卡失败');
  } finally {
    extracting.value = false;
  }
}

function startEdit(card: EventCardItem) {
  editingId.value = card.id;
  editBeat.value = card.beat;
  editStatus.value = card.status;
}

async function saveEdit(card: EventCardItem) {
  try {
    await apiClient.updateEventCard(projectId.value, card.id, {
      beat: editBeat.value.trim(),
      status: editStatus.value,
    });
    editingId.value = null;
    presentSuccess('已保存');
    await loadCards();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '保存失败');
  }
}

async function markPaid(card: EventCardItem) {
  try {
    await apiClient.updateEventCard(projectId.value, card.id, { status: 'paid' });
    presentSuccess('已标为回收');
    await loadCards();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '更新失败');
  }
}

async function removeCard(card: EventCardItem) {
  if (!confirm(`删除事件卡「${card.beat}」？`)) {
    return;
  }
  try {
    await apiClient.deleteEventCard(projectId.value, card.id);
    presentSuccess('已删除');
    await loadCards();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '删除失败');
  }
}

onMounted(() => {
  void loadCards();
});
</script>

<template>
  <div class="event-cards-page">
    <header class="page-header">
      <div>
        <h2 class="page-title">事件卡</h2>
        <p class="page-subtitle">
          跨章记忆主层。写作/改写默认不注入；请在设置中打开「事件卡跨章记忆」后再启用。
        </p>
      </div>
    </header>

    <div class="toolbar">
      <label class="field-label">
        抽取章节
        <input v-model.number="extractChapterNo" class="field-input chapter-input" type="number" min="1" />
      </label>
      <button class="primary-button" type="button" :disabled="extracting || loading" @click="extractChapter">
        {{ extracting ? '抽取中…' : '按章抽取' }}
      </button>
      <button class="secondary-button" type="button" :disabled="loading" @click="loadCards">刷新</button>
    </div>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="loading" class="message">正在加载…</p>
    <p v-else-if="cards.length === 0" class="empty-state">暂无事件卡。可按章抽取，或开启保存后自动抽卡。</p>

    <ul v-else class="card-list">
      <li v-for="card in cards" :key="card.id" class="card-item">
        <div class="card-meta">
          <span>第{{ card.chapterNo }}章</span>
          <span>{{ kindLabel[card.kind] || card.kind }}</span>
          <span>{{ card.status }}</span>
          <span>{{ card.source === 'user_edit' ? '已编辑' : '自动' }}</span>
        </div>
        <template v-if="editingId === card.id">
          <textarea v-model="editBeat" class="field-textarea" rows="2" maxlength="80" />
          <select v-model="editStatus" class="field-input">
            <option value="open">open</option>
            <option value="paid">paid</option>
            <option value="fact">fact</option>
          </select>
          <div class="card-actions">
            <button class="primary-button" type="button" @click="saveEdit(card)">保存</button>
            <button class="secondary-button" type="button" @click="editingId = null">取消</button>
          </div>
        </template>
        <template v-else>
          <p class="card-beat">{{ card.beat }}</p>
          <p v-if="card.entities.length" class="card-entities">人物：{{ card.entities.join('、') }}</p>
          <p v-if="card.evidence" class="card-evidence">证据：{{ card.evidence }}</p>
          <div class="card-actions">
            <button class="table-button" type="button" @click="startEdit(card)">编辑</button>
            <button
              v-if="card.status === 'open'"
              class="table-button"
              type="button"
              @click="markPaid(card)"
            >
              标已回收
            </button>
            <button class="table-button danger" type="button" @click="removeCard(card)">删除</button>
          </div>
        </template>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.event-cards-page {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  max-width: 960px;
  margin: 0 auto;
  padding: 0.25rem 0 1.5rem;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: end;
}
.chapter-input {
  width: 5rem;
}
.card-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.card-item {
  border: 1px solid var(--aq-border);
  border-radius: 8px;
  padding: 0.75rem 0.9rem;
  background: var(--aq-surface);
}
.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--aq-text-secondary);
  margin-bottom: 0.35rem;
}
.card-beat {
  margin: 0 0 0.35rem;
  font-weight: 600;
}
.card-entities,
.card-evidence {
  margin: 0.2rem 0;
  font-size: 0.85rem;
  color: var(--aq-text-secondary);
}
.card-actions {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.5rem;
}
.danger {
  color: #b42318;
}
.field-textarea {
  width: 100%;
  margin-bottom: 0.4rem;
}
</style>
