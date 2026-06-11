<script setup lang="ts">
import * as d3 from 'd3';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PersonaItem, RelationEventItem } from '../../services/api';

const props = defineProps<{
  personas: PersonaItem[];
  relationEvents: RelationEventItem[];
  selectedPersonaId: string | null;
}>();

const emit = defineEmits<{
  selectPersona: [personaId: string];
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const chapterFrom = ref<number | ''>('');
const chapterTo = ref<number | ''>('');
const keyword = ref('');

let simulation: d3.Simulation<GraphNode, undefined> | null = null;
let resizeObserver: ResizeObserver | null = null;

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  eventCount: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  summary: string;
  eventCount: number;
}

const filteredEvents = computed(() => {
  const from = Number(chapterFrom.value);
  const to = Number(chapterTo.value);
  const key = keyword.value.trim().toLowerCase();

  return props.relationEvents.filter((event) => {
    if (typeof event.chapterNo === 'number') {
      if (Number.isFinite(from) && from > 0 && event.chapterNo < from) {
        return false;
      }
      if (Number.isFinite(to) && to > 0 && event.chapterNo > to) {
        return false;
      }
    }
    if (!key) {
      return true;
    }
    const haystack = [event.protagonist, event.counterparty, event.summary]
      .join(' ')
      .toLowerCase();
    return haystack.includes(key);
  });
});

const graphStats = computed(() => {
  const { nodes, links } = buildGraphData();
  return { nodeCount: nodes.length, linkCount: links.length };
});

const showEmptyHint = computed(
  () => graphStats.value.nodeCount === 0 && !props.personas.length
);

const showNoRelationHint = computed(
  () => props.personas.length > 0 && graphStats.value.linkCount === 0
);

function buildGraphData() {
  const events = filteredEvents.value;
  const nodeMap = new Map<string, GraphNode>();

  for (const persona of props.personas) {
    nodeMap.set(persona.id, {
      id: persona.id,
      name: persona.name,
      eventCount: 0,
    });
  }

  const pairCount = new Map<string, number>();
  const pairEvents = new Map<string, RelationEventItem[]>();

  for (const event of events) {
    const sourceId =
      event.protagonistPersonaId ||
      props.personas.find((persona) => persona.name === event.protagonist)?.id;
    const targetId =
      event.counterpartyPersonaId ||
      props.personas.find((persona) => persona.name === event.counterparty)?.id;
    if (!sourceId || !targetId || sourceId === targetId) {
      continue;
    }

    const pairKey = [sourceId, targetId].sort().join('|');
    pairCount.set(pairKey, (pairCount.get(pairKey) ?? 0) + 1);
    const bucket = pairEvents.get(pairKey) ?? [];
    bucket.push(event);
    pairEvents.set(pairKey, bucket);

    const source = nodeMap.get(sourceId);
    const target = nodeMap.get(targetId);
    if (source) {
      source.eventCount += 1;
    }
    if (target) {
      target.eventCount += 1;
    }
  }

  const links: GraphLink[] = [];
  for (const [pairKey, count] of pairCount.entries()) {
    const [source, target] = pairKey.split('|');
    const sample = pairEvents.get(pairKey)?.[0];
    links.push({
      source,
      target,
      id: pairKey,
      summary:
        pairEvents
          .get(pairKey)
          ?.map((event) => `第${event.chapterNo ?? '?'}章 ${event.summary}`)
          .join('\n') || '',
      eventCount: count,
    });
    if (sample && !nodeMap.has(source)) {
      nodeMap.set(source, { id: source, name: sample.protagonist, eventCount: count });
    }
    if (sample && !nodeMap.has(target)) {
      nodeMap.set(target, { id: target, name: sample.counterparty, eventCount: count });
    }
  }

  return {
    nodes: [...nodeMap.values()],
    links,
  };
}

function nodeRadius(nodeData: GraphNode): number {
  return Math.min(26, 18 + Math.min(nodeData.eventCount, 4) * 2);
}

function linkPath(linkData: GraphLink): string {
  const source = linkData.source as GraphNode;
  const target = linkData.target as GraphNode;
  const sx = source.x ?? 0;
  const sy = source.y ?? 0;
  const tx = target.x ?? 0;
  const ty = target.y ?? 0;
  const dx = tx - sx;
  const dy = ty - sy;
  const dr = Math.sqrt(dx * dx + dy * dy);
  if (dr < 1) {
    return `M${sx},${sy} L${tx},${ty}`;
  }
  const curve = Math.min(dr * 0.35, 80);
  const cx = (sx + tx) / 2 + (dy / dr || 0) * curve;
  const cy = (sy + ty) / 2 - (dx / dr || 0) * curve;
  return `M${sx},${sy} Q${cx},${cy} ${tx},${ty}`;
}

function resetFilters() {
  chapterFrom.value = '';
  chapterTo.value = '';
  keyword.value = '';
}

function renderGraph() {
  const container = containerRef.value;
  const svgEl = svgRef.value;
  if (!container || !svgEl) {
    return;
  }

  const width = container.clientWidth || 800;
  const height = 520;
  const { nodes, links } = buildGraphData();

  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();
  svg.attr('viewBox', `0 0 ${width} ${height}`);

  const defs = svg.append('defs');

  defs
    .append('pattern')
    .attr('id', 'graph-dot-grid')
    .attr('width', 20)
    .attr('height', 20)
    .attr('patternUnits', 'userSpaceOnUse')
    .append('circle')
    .attr('cx', 1)
    .attr('cy', 1)
    .attr('r', 1)
    .attr('fill', '#cbd5e1')
    .attr('opacity', 0.55);

  const nodeGradient = defs
    .append('linearGradient')
    .attr('id', 'node-gradient-default')
    .attr('x1', '0%')
    .attr('y1', '0%')
    .attr('x2', '100%')
    .attr('y2', '100%');
  nodeGradient.append('stop').attr('offset', '0%').attr('stop-color', '#eef2ff');
  nodeGradient.append('stop').attr('offset', '100%').attr('stop-color', '#c7d2fe');

  const selectedGradient = defs
    .append('linearGradient')
    .attr('id', 'node-gradient-selected')
    .attr('x1', '0%')
    .attr('y1', '0%')
    .attr('x2', '100%')
    .attr('y2', '100%');
  selectedGradient.append('stop').attr('offset', '0%').attr('stop-color', '#6366f1');
  selectedGradient.append('stop').attr('offset', '100%').attr('stop-color', '#4338ca');

  const shadow = defs
    .append('filter')
    .attr('id', 'node-shadow')
    .attr('x', '-50%')
    .attr('y', '-50%')
    .attr('width', '200%')
    .attr('height', '200%');
  shadow.append('feDropShadow').attr('dx', 0).attr('dy', 2).attr('stdDeviation', 3).attr('flood-opacity', 0.18);

  svg
    .append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', 'url(#graph-dot-grid)')
    .attr('opacity', 0.35);

  const zoomLayer = svg.append('g');
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.45, 2.4])
    .on('zoom', (event) => {
      zoomLayer.attr('transform', event.transform.toString());
    });
  svg.call(zoom as never);

  simulation?.stop();
  simulation = d3
    .forceSimulation(nodes)
    .force(
      'link',
      d3
        .forceLink<GraphNode, GraphLink>(links)
        .id((node) => node.id)
        .distance(150)
        .strength(0.45)
    )
    .force('charge', d3.forceManyBody().strength(-420))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide().radius((node) => nodeRadius(node as GraphNode) + 28));

  const linkGroup = zoomLayer.append('g').attr('class', 'links');

  const link = linkGroup
    .selectAll<SVGPathElement, GraphLink>('path')
    .data(links)
    .join('path')
    .attr('fill', 'none')
    .attr('stroke', '#a5b4fc')
    .attr('stroke-opacity', 0.75)
    .attr('stroke-width', (linkData) => Math.min(6, 1.2 + linkData.eventCount * 0.8))
    .attr('stroke-linecap', 'round');

  link.append('title').text((linkData) => linkData.summary);

  const linkBadge = linkGroup
    .selectAll<SVGTextElement, GraphLink>('text')
    .data(links.filter((item) => item.eventCount > 1))
    .join('text')
    .attr('text-anchor', 'middle')
    .attr('font-size', 10)
    .attr('font-weight', 600)
    .attr('fill', '#4338ca')
    .attr('pointer-events', 'none')
    .text((linkData) => String(linkData.eventCount));

  const node = zoomLayer
    .append('g')
    .selectAll<SVGGElement, GraphNode>('g')
    .data(nodes)
    .join('g')
    .attr('class', 'graph-node')
    .attr('cursor', 'pointer')
    .on('click', (_, nodeData) => emit('selectPersona', nodeData.id));

  const dragBehavior = d3
    .drag<SVGGElement, GraphNode>()
    .on('start', (event, nodeData) => {
      if (!event.active) {
        simulation?.alphaTarget(0.28).restart();
      }
      nodeData.fx = nodeData.x;
      nodeData.fy = nodeData.y;
    })
    .on('drag', (event, nodeData) => {
      nodeData.fx = event.x;
      nodeData.fy = event.y;
    })
    .on('end', (event, nodeData) => {
      if (!event.active) {
        simulation?.alphaTarget(0);
      }
      nodeData.fx = null;
      nodeData.fy = null;
    });

  node.call(dragBehavior);

  node
    .append('circle')
    .attr('class', 'node-halo')
    .attr('r', (nodeData) => nodeRadius(nodeData) + 6)
    .attr('fill', 'none')
    .attr('stroke', '#818cf8')
    .attr('stroke-width', 2)
    .attr('opacity', (nodeData) => (nodeData.id === props.selectedPersonaId ? 0.85 : 0));

  node
    .append('circle')
    .attr('class', 'node-circle')
    .attr('r', (nodeData) => nodeRadius(nodeData))
    .attr('fill', (nodeData) =>
      nodeData.id === props.selectedPersonaId ? 'url(#node-gradient-selected)' : 'url(#node-gradient-default)'
    )
    .attr('stroke', (nodeData) => (nodeData.id === props.selectedPersonaId ? '#312e81' : '#6366f1'))
    .attr('stroke-width', (nodeData) => (nodeData.id === props.selectedPersonaId ? 2.5 : 1.5))
    .attr('filter', 'url(#node-shadow)');

  node
    .append('text')
    .attr('class', 'node-initial')
    .text((nodeData) => nodeData.name.slice(0, 1))
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('font-size', (nodeData) => Math.max(13, nodeRadius(nodeData) * 0.62))
    .attr('font-weight', 700)
    .attr('fill', (nodeData) => (nodeData.id === props.selectedPersonaId ? '#fff' : '#4338ca'))
    .attr('pointer-events', 'none');

  node
    .append('text')
    .attr('class', 'node-label')
    .text((nodeData) => nodeData.name)
    .attr('y', (nodeData) => nodeRadius(nodeData) + 16)
    .attr('text-anchor', 'middle')
    .attr('font-size', 12)
    .attr('font-weight', (nodeData) => (nodeData.id === props.selectedPersonaId ? 700 : 500))
    .attr('fill', '#0f172a')
    .attr('pointer-events', 'none');

  node
    .on('mouseenter', function () {
      d3.select(this).select('.node-circle').attr('stroke-width', 2.5);
    })
    .on('mouseleave', function (_, nodeData) {
      const selected = nodeData.id === props.selectedPersonaId;
      d3.select(this).select('.node-circle').attr('stroke-width', selected ? 2.5 : 1.5);
    });

  simulation.on('tick', () => {
    link.attr('d', linkPath);

    linkBadge
      .attr('x', (linkData) => {
        const source = linkData.source as GraphNode;
        const target = linkData.target as GraphNode;
        return ((source.x ?? 0) + (target.x ?? 0)) / 2;
      })
      .attr('y', (linkData) => {
        const source = linkData.source as GraphNode;
        const target = linkData.target as GraphNode;
        return ((source.y ?? 0) + (target.y ?? 0)) / 2 - 4;
      });

    node.attr('transform', (nodeData) => `translate(${nodeData.x ?? 0},${nodeData.y ?? 0})`);
  });
}

onMounted(() => {
  renderGraph();
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => renderGraph());
    resizeObserver.observe(containerRef.value);
  }
});

onBeforeUnmount(() => {
  simulation?.stop();
  resizeObserver?.disconnect();
});

watch(
  () => [props.personas, props.relationEvents, filteredEvents.value, props.selectedPersonaId],
  () => renderGraph()
);
</script>

<template>
  <div ref="containerRef" class="graph-panel">
    <div class="graph-header">
      <div class="graph-header-main">
        <h4 class="graph-title">角色关系图</h4>
        <p class="graph-desc">基于关系事件自动生成，点击节点可定位人物。</p>
      </div>
      <div class="graph-stats">
        <span class="stat-chip">{{ graphStats.nodeCount }} 角色</span>
        <span class="stat-chip">{{ graphStats.linkCount }} 关系</span>
      </div>
    </div>

    <div class="graph-toolbar">
      <div class="toolbar-field">
        <span class="toolbar-label">章节从</span>
        <input
          v-model="chapterFrom"
          class="toolbar-input"
          type="number"
          min="1"
          placeholder="1"
          aria-label="章节起始"
        />
      </div>
      <div class="toolbar-field">
        <span class="toolbar-label">到</span>
        <input
          v-model="chapterTo"
          class="toolbar-input"
          type="number"
          min="1"
          placeholder="∞"
          aria-label="章节结束"
        />
      </div>
      <div class="toolbar-field toolbar-field--grow">
        <span class="toolbar-label">角色名</span>
        <input
          v-model="keyword"
          class="toolbar-input toolbar-input--wide"
          type="text"
          placeholder="搜索角色或事件摘要"
          aria-label="角色名筛选"
        />
      </div>
      <button class="aq-btn aq-btn-ghost toolbar-reset" type="button" @click="resetFilters">
        重置
      </button>
    </div>

    <div class="graph-stage">
      <svg ref="svgRef" class="graph-svg" role="img" aria-label="角色关系力导向图" />
      <div v-if="showEmptyHint" class="graph-overlay">
        <p class="overlay-title">暂无可展示的角色</p>
        <p class="overlay-desc">请先在人物清单中新增人物，并维护关系事件。</p>
      </div>
      <div v-else-if="showNoRelationHint" class="graph-overlay graph-overlay--muted">
        <p class="overlay-title">暂无关系连线</p>
        <p class="overlay-desc">当前筛选条件下没有可连接的关系事件，可调整章节范围或添加关系事件。</p>
      </div>
      <div class="graph-legend" aria-hidden="true">
        <span class="legend-item"><span class="legend-dot legend-dot--default" />人物</span>
        <span class="legend-item"><span class="legend-dot legend-dot--selected" />已选中</span>
        <span class="legend-item"><span class="legend-line" />关系事件</span>
      </div>
      <p class="graph-tip">滚轮缩放 · 拖拽节点 · 点击选中</p>
    </div>
  </div>
</template>

<style scoped>
.graph-panel {
  border: 1px solid var(--aq-border);
  border-radius: var(--aq-radius-sm);
  background: var(--aq-surface);
  padding: 1.1rem;
  box-shadow: var(--aq-shadow-sm);
}

.graph-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

.graph-title {
  margin: 0 0 0.2rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--aq-text);
}

.graph-desc {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--aq-text-secondary);
}

.graph-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.stat-chip {
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: var(--aq-primary-soft);
  color: var(--aq-primary-hover);
  font-size: 0.75rem;
  font-weight: 600;
}

.graph-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.65rem;
  margin-bottom: 0.85rem;
  padding: 0.75rem;
  border-radius: var(--aq-radius-xs);
  background: var(--aq-surface-muted);
  border: 1px solid var(--aq-border);
}

.toolbar-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.toolbar-field--grow {
  flex: 1 1 10rem;
  min-width: 8rem;
}

.toolbar-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--aq-text-secondary);
}

.toolbar-input {
  width: 5.5rem;
  border: 1px solid var(--aq-border-strong);
  border-radius: var(--aq-radius-xs);
  padding: 0.4rem 0.55rem;
  font-size: 0.875rem;
  font-family: inherit;
  color: var(--aq-text);
  background: var(--aq-surface);
  transition: border-color var(--aq-transition), box-shadow var(--aq-transition);
}

.toolbar-input--wide {
  width: 100%;
  min-width: 0;
}

.toolbar-input:focus {
  outline: none;
  border-color: var(--aq-primary);
  box-shadow: 0 0 0 3px rgb(79 70 229 / 12%);
}

.toolbar-reset {
  align-self: flex-end;
  font-size: 0.8125rem;
}

.graph-stage {
  position: relative;
}

.graph-svg {
  display: block;
  width: 100%;
  height: 520px;
  border-radius: var(--aq-radius-xs);
  border: 1px solid var(--aq-border);
  background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
}

.graph-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 1.5rem;
  border-radius: var(--aq-radius-xs);
  background: rgb(255 255 255 / 82%);
  backdrop-filter: blur(2px);
  text-align: center;
  pointer-events: none;
}

.graph-overlay--muted {
  background: rgb(248 250 252 / 55%);
}

.overlay-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--aq-text);
}

.overlay-desc {
  margin: 0;
  max-width: 22rem;
  font-size: 0.8125rem;
  line-height: 1.55;
  color: var(--aq-text-secondary);
}

.graph-legend {
  position: absolute;
  left: 0.75rem;
  bottom: 2.1rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  padding: 0.35rem 0.55rem;
  border-radius: 999px;
  background: rgb(255 255 255 / 88%);
  border: 1px solid var(--aq-border);
  font-size: 0.75rem;
  color: var(--aq-text-secondary);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.legend-dot {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 50%;
  border: 1.5px solid #6366f1;
  background: #eef2ff;
}

.legend-dot--selected {
  border-color: #312e81;
  background: #6366f1;
}

.legend-line {
  width: 1rem;
  height: 0;
  border-top: 2px solid #a5b4fc;
}

.graph-tip {
  position: absolute;
  right: 0.75rem;
  bottom: 0.55rem;
  margin: 0;
  font-size: 0.75rem;
  color: var(--aq-text-muted);
}

@media (max-width: 640px) {
  .graph-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-input {
    width: 100%;
  }

  .toolbar-reset {
    align-self: stretch;
  }

  .graph-legend {
    position: static;
    margin-top: 0.5rem;
    border-radius: var(--aq-radius-xs);
  }

  .graph-tip {
    position: static;
    margin-top: 0.35rem;
    text-align: right;
  }
}
</style>
