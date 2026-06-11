<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import AppModal from '../components/common/AppModal.vue';
import { confirmAction } from '../composables/useAppConfirm';
import {
  apiClient,
  type DocType,
  type DocumentItem,
  type ChunkItem,
  type DocumentVersionItem,
} from '../services/api';
import {
  presentError,
  presentErrorFromCaught,
  presentInfo,
  presentSuccess,
} from '../utils/pageFeedback';

const route = useRoute();
const projectId = computed(() => String(route.params.id || ''));

const documents = ref<DocumentItem[]>([]);
const loading = ref(false);
const submitting = ref(false);
const indexing = ref(false);
const message = ref('');
const errorMessage = ref('');

const showDocModal = ref(false);
const editingDocId = ref<string | null>(null);
const formTitle = ref('');
const formContent = ref('');
const formDocType = ref<DocType>('other');
const filterDocType = ref<DocType | ''>('');

const docTypeOptions: Array<{ value: DocType; label: string }> = [
  { value: 'persona_card', label: '角色卡' },
  { value: 'world_setting', label: '世界观' },
  { value: 'reference', label: '参考资料' },
  { value: 'lore', label: '设定 lore' },
  { value: 'other', label: '其他' },
];

const filteredDocuments = computed(() => {
  if (!filterDocType.value) {
    return documents.value;
  }
  return documents.value.filter((doc) => (doc.docType ?? 'other') === filterDocType.value);
});

const docModalTitle = computed(() => (editingDocId.value ? '编辑文档' : '新建文档'));

const docModalSubtitle = computed(() =>
  editingDocId.value ? '修改标题、类型或正文后保存即可。' : '填写文档信息，创建后可触发索引供检索使用。'
);

const docModalSubmitLabel = computed(() => {
  if (submitting.value) {
    return editingDocId.value ? '保存中...' : '创建中...';
  }
  return editingDocId.value ? '保存修改' : '创建文档';
});

function docTypeLabel(value?: DocType): string {
  return docTypeOptions.find((o) => o.value === (value ?? 'other'))?.label ?? '其他';
}

const selectedDoc = ref<DocumentItem | null>(null);
const chunks = ref<ChunkItem[]>([]);
const versions = ref<DocumentVersionItem[]>([]);
const showChunks = ref(false);
const showVersions = ref(false);
const loadingDetails = ref(false);
const expandedDocIds = ref<Set<string>>(new Set());

const CONTENT_PREVIEW_LIMIT = 2000;

function isExpanded(docId: string): boolean {
  return expandedDocIds.value.has(docId);
}

function toggleDocExpand(docId: string) {
  const next = new Set(expandedDocIds.value);
  if (next.has(docId)) {
    next.delete(docId);
  } else {
    next.add(docId);
  }
  expandedDocIds.value = next;
}

function previewContent(content?: string): string {
  const text = content?.trim() || '（无内容）';
  if (text.length <= CONTENT_PREVIEW_LIMIT) {
    return text;
  }
  return `${text.slice(0, CONTENT_PREVIEW_LIMIT)}…`;
}

function resetDocForm() {
  editingDocId.value = null;
  formTitle.value = '';
  formContent.value = '';
  formDocType.value = 'other';
}

function openCreateModal() {
  errorMessage.value = '';
  resetDocForm();
  showDocModal.value = true;
}

function openEditModal(doc: DocumentItem) {
  errorMessage.value = '';
  editingDocId.value = doc.id;
  formTitle.value = doc.title;
  formContent.value = doc.content;
  formDocType.value = doc.docType ?? 'other';
  showDocModal.value = true;
}

function closeDocModal() {
  if (submitting.value) {
    return;
  }
  showDocModal.value = false;
  resetDocForm();
}

async function loadDocuments() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const response = (await apiClient.documents.list(projectId.value)) as any;
    documents.value = response?.data ?? (Array.isArray(response) ? response : []);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载文档失败');
  } finally {
    loading.value = false;
  }
}

async function handleSubmitDoc() {
  if (!formTitle.value.trim()) {
    errorMessage.value = presentError('请填写文档标题');
    return;
  }

  submitting.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    if (editingDocId.value) {
      await apiClient.updateDocument(editingDocId.value, {
        title: formTitle.value.trim() || undefined,
        content: formContent.value || undefined,
        docType: formDocType.value,
      });
      message.value = presentSuccess('文档已更新');
    } else {
      await apiClient.documents.create(projectId.value, {
        title: formTitle.value.trim(),
        content: formContent.value,
        docType: formDocType.value,
      });
      message.value = presentSuccess('文档已创建');
    }

    showDocModal.value = false;
    resetDocForm();
    await loadDocuments();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(
      error,
      editingDocId.value ? '更新文档失败' : '创建文档失败'
    );
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(doc: DocumentItem) {
  const confirmed = await confirmAction({
    title: '删除文档',
    content: `确定删除「${doc.title}」？此操作不可撤销。`,
    okText: '删除',
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  errorMessage.value = '';
  message.value = '';
  try {
    await apiClient.deleteDocument(doc.id);
    message.value = presentSuccess('文档已删除');
    if (selectedDoc.value?.id === doc.id) {
      selectedDoc.value = null;
      chunks.value = [];
      versions.value = [];
    }
    await loadDocuments();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '删除文档失败');
  }
}

async function handleReindex(doc: DocumentItem) {
  indexing.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    const result = (await apiClient.documents.reindex(doc.id)) as any;
    const data = result?.data ?? result;
    message.value = presentInfo(`索引任务已提交（${data.indexStatus || 'processing'}）`);
    await loadDocuments();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '启动索引失败');
  } finally {
    indexing.value = false;
  }
}

async function viewDetails(doc: DocumentItem) {
  selectedDoc.value = doc;
  showChunks.value = false;
  showVersions.value = false;
  chunks.value = [];
  versions.value = [];
}

async function loadChunks(doc: DocumentItem) {
  loadingDetails.value = true;
  showVersions.value = false;
  showChunks.value = true;
  try {
    const response = (await apiClient.documents.getChunks(doc.id)) as any;
    chunks.value = response?.data ?? (Array.isArray(response) ? response : []);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载 chunks 失败');
    chunks.value = [];
  } finally {
    loadingDetails.value = false;
  }
}

async function loadVersions(doc: DocumentItem) {
  loadingDetails.value = true;
  showChunks.value = false;
  showVersions.value = true;
  try {
    const response = (await apiClient.getDocumentVersions(doc.id)) as any;
    versions.value = response?.data ?? (Array.isArray(response) ? response : []);
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '加载版本历史失败');
    versions.value = [];
  } finally {
    loadingDetails.value = false;
  }
}

function getStatusClass(status: string) {
  switch (status) {
    case 'completed':
      return 'status-ok';
    case 'indexing':
      return 'status-running';
    case 'failed':
      return 'status-error';
    default:
      return 'status-pending';
  }
}

onMounted(() => {
  void loadDocuments();
});
</script>

<template>
  <div class="knowledge-page">
    <header class="page-header">
      <div>
        <h2 class="page-title">知识库</h2>
        <p class="page-subtitle">管理项目文档，上传后可以自动分块索引供检索使用。</p>
      </div>
    </header>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="message" class="message message-ok">{{ message }}</p>

    <section class="panel">
      <div class="panel-header">
        <h3 class="panel-title">文档列表</h3>
        <div class="panel-header-actions">
          <label class="filter-label" for="doc-type-filter">类型筛选</label>
          <select id="doc-type-filter" v-model="filterDocType" class="field-input filter-select">
            <option value="">全部类型</option>
            <option v-for="opt in docTypeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
          <button class="primary-button" type="button" @click="openCreateModal">新建文档</button>
        </div>
      </div>

      <p v-if="loading" class="message">正在加载文档...</p>

      <div v-else-if="documents.length === 0" class="empty-state">
        <p>暂无文档，点击「新建文档」开始添加。</p>
      </div>

      <div v-else-if="filteredDocuments.length === 0" class="empty-state">
        <p>当前筛选条件下暂无文档。</p>
      </div>

      <div v-else class="doc-list">
        <article v-for="doc in filteredDocuments" :key="doc.id" class="doc-card">
          <header class="doc-header">
            <div class="doc-info">
              <h4 class="doc-title">{{ doc.title }}</h4>
              <div class="doc-meta">
                <span class="doc-type-tag">{{ docTypeLabel(doc.docType) }}</span>
                <span class="doc-version">v{{ doc.version }}</span>
                <span :class="['doc-status', getStatusClass(doc.indexStatus)]">
                  {{
                    doc.indexStatus === 'completed'
                      ? '已索引'
                      : doc.indexStatus === 'indexing'
                        ? '索引中'
                        : doc.indexStatus === 'failed'
                          ? '索引失败'
                          : '待索引'
                  }}
                </span>
                <span class="doc-date">{{ new Date(doc.updatedAt).toLocaleDateString() }}</span>
              </div>
            </div>
            <button
              class="action-button expand-button"
              type="button"
              @click="toggleDocExpand(doc.id)"
            >
              {{ isExpanded(doc.id) ? '收起预览' : '展开预览' }}
            </button>
          </header>

          <p v-if="!isExpanded(doc.id)" class="doc-content-preview">
            {{ doc.content?.slice(0, 120) || '无内容' }}
          </p>
          <pre v-else class="doc-content-expanded">{{ previewContent(doc.content) }}</pre>

          <div class="doc-actions">
            <button class="action-button" type="button" title="详情" @click="viewDetails(doc)">
              详情
            </button>
            <button class="action-button" type="button" title="编辑" @click="openEditModal(doc)">
              编辑
            </button>
            <button
              class="action-button"
              :disabled="indexing"
              title="索引"
              @click="handleReindex(doc)"
            >
              {{ indexing ? '索引中...' : '索引' }}
            </button>
            <button
              class="action-button action-danger"
              type="button"
              title="删除"
              @click="handleDelete(doc)"
            >
              删除
            </button>
          </div>
        </article>
      </div>
    </section>

    <section v-if="selectedDoc" class="panel">
      <div class="panel-header">
        <h3 class="panel-title">文档详情：{{ selectedDoc.title }}</h3>
        <div class="panel-header-actions">
          <button class="secondary-button" type="button" @click="loadChunks(selectedDoc)">
            查看 Chunks
          </button>
          <button class="secondary-button" type="button" @click="loadVersions(selectedDoc)">
            查看版本历史
          </button>
        </div>
      </div>

      <div v-if="loadingDetails" class="message">加载中...</div>

      <div v-if="showChunks && chunks.length > 0" class="detail-section">
        <h4>Chunks（{{ chunks.length }}）</h4>
        <div v-for="chunk in chunks" :key="chunk.id" class="chunk-card">
          <p class="chunk-content">{{ chunk.content }}</p>
          <p class="chunk-meta">ID: {{ chunk.id }}</p>
        </div>
      </div>

      <div v-if="showVersions && versions.length > 0" class="detail-section">
        <h4>版本历史（{{ versions.length }}）</h4>
        <div v-for="ver in versions" :key="ver.version" class="version-card">
          <div class="version-header">
            <strong>v{{ ver.version }}</strong>
            <span>{{ new Date(ver.createdAt).toLocaleString() }}</span>
          </div>
          <p class="version-title">{{ ver.title }}</p>
          <p class="version-content">
            {{ ver.content?.slice(0, 200) }}{{ ver.content?.length > 200 ? '...' : '' }}
          </p>
        </div>
      </div>

      <div v-if="showChunks && chunks.length === 0 && !loadingDetails" class="empty-state">
        <p>该文档尚未分块，请先点击「索引」按钮。</p>
      </div>
    </section>

    <AppModal
      :open="showDocModal"
      :title="docModalTitle"
      :subtitle="docModalSubtitle"
      title-id="doc-form-title"
      :width="720"
      @close="closeDocModal"
    >
      <div class="modal-form">
        <div class="field-group">
          <label class="field-label" for="doc-form-title-input">文档标题</label>
          <input
            id="doc-form-title-input"
            v-model="formTitle"
            class="field-input"
            placeholder="文档标题"
          />
        </div>
        <div class="field-group">
          <label class="field-label" for="doc-form-type">文档类型</label>
          <select id="doc-form-type" v-model="formDocType" class="field-input">
            <option v-for="opt in docTypeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="field-group">
          <label class="field-label" for="doc-form-content">文档内容</label>
          <textarea
            id="doc-form-content"
            v-model="formContent"
            class="field-textarea field-textarea-large"
            placeholder="粘贴或输入文档内容"
          />
        </div>
      </div>

      <template #footer>
        <button
          class="secondary-button"
          type="button"
          :disabled="submitting"
          @click="closeDocModal"
        >
          取消
        </button>
        <button
          class="primary-button"
          type="button"
          :disabled="submitting"
          @click="handleSubmitDoc"
        >
          {{ docModalSubmitLabel }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.knowledge-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0.25rem 0 1.5rem;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-bottom: 1rem;
}

.panel-header-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.filter-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--aq-text-secondary);
  white-space: nowrap;
}

.filter-select {
  width: auto;
  min-width: 9.5rem;
  margin: 0;
}

.modal-form {
  display: flex;
  flex-direction: column;
}

.modal-form .field-group:last-child {
  margin-bottom: 0;
}

.field-textarea-large {
  min-height: 220px;
}

.doc-list {
  display: grid;
  gap: 0.75rem;
}

.doc-card {
  border: 1px solid var(--aq-border);
  border-radius: var(--aq-radius-xs);
  overflow: hidden;
  background: var(--aq-surface);
}

.doc-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 0.85rem 0.5rem;
}

.doc-info {
  flex: 1;
  min-width: 0;
}

.doc-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 0.4rem;
  color: var(--aq-text);
}

.doc-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.8rem;
  color: var(--aq-text-secondary);
}

.doc-type-tag {
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--aq-primary-soft);
  color: var(--aq-primary-hover);
  font-weight: 500;
}

.doc-version {
  background: var(--aq-bg-subtle);
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
}

.doc-status {
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
}

.status-ok {
  background: #d1fae5;
  color: #065f46;
}

.status-running {
  background: #dbeafe;
  color: #1e40af;
}

.status-error {
  background: #fee2e2;
  color: #991b1b;
}

.status-pending {
  background: #f3f4f6;
  color: #6b7280;
}

.doc-content-preview {
  margin: 0;
  padding: 0 0.85rem 0.65rem;
  font-size: 0.85rem;
  color: var(--aq-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-content-expanded {
  margin: 0 0.85rem 0.65rem;
  padding: 0.75rem;
  border-radius: var(--aq-radius-xs);
  background: var(--aq-surface-muted);
  border: 1px solid var(--aq-border);
  font-size: 0.85rem;
  line-height: 1.65;
  color: var(--aq-text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 360px;
  overflow-y: auto;
  font-family: inherit;
}

.expand-button {
  flex-shrink: 0;
}

.doc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.55rem 0.85rem;
  background: var(--aq-surface-muted);
  border-top: 1px solid var(--aq-border);
}

.detail-section {
  margin-top: 0.75rem;
}

.detail-section h4 {
  margin-bottom: 0.5rem;
}

.chunk-card,
.version-card {
  border: 1px solid var(--aq-border);
  border-radius: var(--aq-radius-xs);
  padding: 0.6rem;
  margin-bottom: 0.5rem;
  background: var(--aq-surface-muted);
}

.chunk-content {
  font-size: 0.85rem;
  color: var(--aq-text-secondary);
  margin-bottom: 0.25rem;
}

.chunk-meta {
  font-size: 0.75rem;
  color: var(--aq-text-muted);
}

.version-header {
  display: flex;
  gap: 0.75rem;
  font-size: 0.85rem;
  margin-bottom: 0.25rem;
}

.version-title {
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 0.25rem;
}

.version-content {
  font-size: 0.85rem;
  color: var(--aq-text-secondary);
}

@media (max-width: 640px) {
  .panel-header-actions {
    width: 100%;
  }

  .filter-select {
    flex: 1;
    min-width: 0;
  }

  .panel-header-actions .primary-button {
    width: 100%;
  }
}
</style>
