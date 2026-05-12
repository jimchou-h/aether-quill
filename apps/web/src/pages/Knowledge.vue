<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  apiClient,
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

const showCreateForm = ref(false);
const newTitle = ref('');
const newContent = ref('');

const editingDoc = ref<DocumentItem | null>(null);
const editTitle = ref('');
const editContent = ref('');

const selectedDoc = ref<DocumentItem | null>(null);
const chunks = ref<ChunkItem[]>([]);
const versions = ref<DocumentVersionItem[]>([]);
const showChunks = ref(false);
const showVersions = ref(false);
const loadingDetails = ref(false);

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

async function handleCreate() {
  if (!newTitle.value.trim()) {
    errorMessage.value = presentError('请填写文档标题');
    return;
  }

  submitting.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    await apiClient.documents.create(projectId.value, {
      title: newTitle.value.trim(),
      content: newContent.value,
    });
    newTitle.value = '';
    newContent.value = '';
    showCreateForm.value = false;
    message.value = presentSuccess('文档已创建');
    await loadDocuments();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '创建文档失败');
  } finally {
    submitting.value = false;
  }
}

function startEdit(doc: DocumentItem) {
  editingDoc.value = doc;
  editTitle.value = doc.title;
  editContent.value = doc.content;
}

async function handleUpdate() {
  if (!editingDoc.value) return;

  submitting.value = true;
  errorMessage.value = '';
  message.value = '';
  try {
    await apiClient.updateDocument(editingDoc.value.id, {
      title: editTitle.value.trim() || undefined,
      content: editContent.value || undefined,
    });
    editingDoc.value = null;
    message.value = presentSuccess('文档已更新');
    await loadDocuments();
  } catch (error) {
    errorMessage.value = presentErrorFromCaught(error, '更新文档失败');
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(doc: DocumentItem) {
  if (!confirm(`确定删除「${doc.title}」？此操作不可撤销。`)) return;

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
    <h2 class="page-title">知识库</h2>
    <p class="page-subtitle">管理项目文档，上传后可以自动分块索引供检索使用。</p>

    <p v-if="errorMessage" class="message message-error">{{ errorMessage }}</p>
    <p v-if="message" class="message message-ok">{{ message }}</p>

    <section class="panel">
      <div class="panel-header">
        <h3 class="panel-title">文档列表</h3>
        <button class="primary-button" @click="showCreateForm = !showCreateForm">
          {{ showCreateForm ? '取消' : '新建文档' }}
        </button>
      </div>

      <form v-if="showCreateForm" class="create-form" @submit.prevent="handleCreate">
        <div class="field-group">
          <label class="field-label">文档标题</label>
          <input v-model="newTitle" class="field-input" placeholder="文档标题" />
        </div>
        <div class="field-group">
          <label class="field-label">文档内容</label>
          <textarea
            v-model="newContent"
            class="field-textarea field-textarea-large"
            placeholder="粘贴或输入文档内容"
          />
        </div>
        <button class="primary-button" type="submit" :disabled="submitting">
          {{ submitting ? '创建中...' : '创建文档' }}
        </button>
      </form>

      <p v-if="loading" class="message">正在加载文档...</p>

      <div v-else-if="documents.length === 0" class="empty-state">
        <p>暂无文档，点击「新建文档」开始添加。</p>
      </div>

      <div v-else class="doc-list">
        <div v-for="doc in documents" :key="doc.id" class="doc-card">
          <div class="doc-main" @click="viewDetails(doc)">
            <div class="doc-info">
              <h4 class="doc-title">{{ doc.title }}</h4>
              <div class="doc-meta">
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
            <div class="doc-content-preview">{{ doc.content?.slice(0, 120) || '无内容' }}</div>
          </div>
          <div class="doc-actions">
            <button class="action-button" title="编辑" @click="startEdit(doc)">编辑</button>
            <button
              class="action-button"
              :disabled="indexing"
              title="索引"
              @click="handleReindex(doc)"
            >
              {{ indexing ? '索引中...' : '索引' }}
            </button>
            <button class="action-button action-danger" title="删除" @click="handleDelete(doc)">
              删除
            </button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="editingDoc" class="panel">
      <h3 class="panel-title">编辑文档：{{ editTitle }}</h3>
      <form @submit.prevent="handleUpdate">
        <div class="field-group">
          <label class="field-label">文档标题</label>
          <input v-model="editTitle" class="field-input" />
        </div>
        <div class="field-group">
          <label class="field-label">文档内容</label>
          <textarea v-model="editContent" class="field-textarea field-textarea-large" />
        </div>
        <div class="actions-row">
          <button class="primary-button" type="submit" :disabled="submitting">
            {{ submitting ? '保存中...' : '保存' }}
          </button>
          <button class="secondary-button" type="button" @click="editingDoc = null">取消</button>
        </div>
      </form>
    </section>

    <section v-if="selectedDoc" class="panel">
      <div class="panel-header">
        <h3 class="panel-title">文档详情：{{ selectedDoc.title }}</h3>
        <div class="actions-row">
          <button class="secondary-button" @click="loadChunks(selectedDoc)">查看 Chunks</button>
          <button class="secondary-button" @click="loadVersions(selectedDoc)">查看版本历史</button>
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
  </div>
</template>

<style scoped>
.knowledge-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1rem;
}

.page-title {
  margin-bottom: 0.25rem;
}

.page-subtitle {
  color: #666;
  margin-bottom: 1rem;
}

.panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #fff;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.panel-title {
  margin: 0;
}

.create-form {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: #f9fafb;
}

.field-group {
  margin-bottom: 0.75rem;
}

.field-label {
  display: block;
  margin-bottom: 0.35rem;
  font-weight: 600;
}

.field-input,
.field-textarea {
  width: 100%;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 0.5rem 0.6rem;
  font-size: 0.95rem;
}

.field-textarea {
  min-height: 100px;
  resize: vertical;
}

.field-textarea-large {
  min-height: 200px;
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: #888;
}

.doc-list {
  display: grid;
  gap: 0.75rem;
}

.doc-card {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.doc-main {
  padding: 0.75rem;
  cursor: pointer;
  transition: background 0.15s;
}

.doc-main:hover {
  background: #f9fafb;
}

.doc-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.35rem;
}

.doc-title {
  font-size: 1rem;
  margin: 0;
}

.doc-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: #666;
}

.doc-version {
  background: #e5e7eb;
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
  font-size: 0.85rem;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-actions {
  display: flex;
  gap: 0.25rem;
  padding: 0.5rem 0.75rem;
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
}

.action-button {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
  border-radius: 4px;
  padding: 0.25rem 0.6rem;
  font-size: 0.8rem;
  cursor: pointer;
}

.action-button:hover {
  background: #f3f4f6;
}

.action-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-danger {
  color: #dc2626;
}

.action-danger:hover {
  background: #fee2e2;
  border-color: #dc2626;
}

.actions-row {
  display: flex;
  gap: 0.5rem;
}

.primary-button,
.secondary-button {
  border-radius: 6px;
  padding: 0.5rem 0.85rem;
  cursor: pointer;
  font-size: 0.9rem;
}

.primary-button {
  border: none;
  background: #1d4ed8;
  color: #fff;
}

.secondary-button {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
}

.primary-button:disabled,
.secondary-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.detail-section {
  margin-top: 0.75rem;
}

.detail-section h4 {
  margin-bottom: 0.5rem;
}

.chunk-card,
.version-card {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.6rem;
  margin-bottom: 0.5rem;
  background: #fafafa;
}

.chunk-content {
  font-size: 0.85rem;
  color: #4b5563;
  margin-bottom: 0.25rem;
}

.chunk-meta {
  font-size: 0.75rem;
  color: #9ca3af;
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
  color: #6b7280;
}

.message {
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}

.message-ok {
  color: #027a48;
}

.message-error {
  color: #b42318;
}
</style>
