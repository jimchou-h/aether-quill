<script setup lang="ts">
import * as d3 from 'd3';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type {
  PersonaIdentityRelationItem,
  PersonaItem,
  RelationEventItem,
} from '../../services/api';
import {
  buildEventRelationGraph,
  buildIdentityRelationGraph,
  type PersonaGraphLink,
} from '../../utils/personaGraph';

const props = defineProps<{
  personas: PersonaItem[];
  relationEvents: RelationEventItem[];
  identityRelations: PersonaIdentityRelationItem[];
  selectedPersonaId: string | null;
}>();

const emit = defineEmits<{
  selectPersona: [personaId: string];
}>();

type GraphMode = 'identity' | 'events';

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const graphMode = ref<GraphMode>('identity');
const chapterFrom = ref<number | ''>('');
const chapterTo = ref<number | ''>('');
const keyword = ref('');

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  weight: number;
}

interface SimLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  label: string;
  tooltip: string;
  strength: number;
  directed?: boolean;
}

let simulation: d3.Simulation<GraphNode, undefined> | null = null;
let resizeObserver: ResizeObserver | null = null;

const graphData = computed(() => {
  if (graphMode.value === 'identity') {
    return buildIdentityRelationGraph(props.personas, props.identityRelations);
  }
  return buildEventRelationGraph(props.personas, props.relationEvents, {
    chapterFrom: chapterFrom.value,
    chapterTo: chapterTo.value,
    keyword: keyword.value,
  });
});

const graphStats = computed(() => ({
  nodeCount: graphData.value.nodes.length,
  linkCount: graphData.value.links.length,
}));

const graphDesc = computed(() =>
  graphMode.value === 'identity'
    ? '展示师徒、恋人等稳定身份关系；摘要生成时会自动识别并更新。'
    : '基于关系事件自动生成，反映剧情互动频次。'
);

const showEmptyHint = computed(
  () => graphStats.value.nodeCount === 0 && props.personas.length === 0
);

const showNoRelationHint = computed(
  () => props.personas.length > 0 && graphStats.value.linkCount === 0
);

const noRelationHint = computed(() =>
  graphMode.value === 'identity'
    ? '暂无身份关系。可为章节生成摘要后自动识别，或在关系事件中维护剧情事实。'
    : '当前筛选条件下没有可连接的关系事件，可调整章节范围或添加关系事件。'
);

function toSimulationData(links: PersonaGraphLink[]) {
  const nodes: GraphNode[] = graphData.value.nodes.map((node) => ({
    id: node.id,
    name: node.name,
    weight: node.weight,
  }));

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const simLinks: SimLink[] = [];

  for (const link of links) {
    const source = nodeById.get(link.sourceId);
    const target = nodeById.get(link.targetId);
    if (!source || !target) {
      continue;
    }
    simLinks.push({
      id: link.id,
      source,
      target,
      label: link.label,
      tooltip: link.tooltip,
      strength: link.strength,
      directed: link.directed,
    });
  }

  return { nodes, links: simLinks };
}

function nodeRadius(nodeData: GraphNode): number {
  return Math.min(26, 18 + Math.min(nodeData.weight, 4) * 2);
}

function nodeCollideRadius(nodeData: GraphNode): number {
  const circle = nodeRadius(nodeData);
  const labelHalfWidth = Math.min(nodeData.name.length, 8) * 6.5;
  return Math.max(circle + 42, labelHalfWidth + 14, 52);
}

function graphHeight(nodeCount: number): number {
  return Math.max(560, Math.min(760, 420 + nodeCount * 28));
}

function linkDistance(nodeCount: number, isIdentity: boolean): number {
  const base = isIdentity ? 200 : 170;
  return Math.max(base, 130 + nodeCount * 10);
}

function chargeStrength(nodeCount: number): number {
  return -Math.max(520, 380 + nodeCount * 35);
}

function initializeNodePositions(
  nodes: GraphNode[],
  width: number,
  height: number,
  linkCount: number
) {
  const cx = width / 2;
  const cy = height / 2;
  const densityFactor = linkCount === 0 ? 0.42 : nodes.length > 12 ? 0.38 : 0.34;
  const spread = Math.min(width, height) * densityFactor;
  nodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1) - Math.PI / 2;
    node.x = cx + Math.cos(angle) * spread;
    node.y = cy + Math.sin(angle) * spread;
  });
}

function formatNodeLabel(name: string): string {
  if (name.length <= 8) {
    return name;
  }
  return `${name.slice(0, 7)}…`;
}

function formatLinkLabel(label: string): string {
  if (label.length <= 10) {
    return label;
  }
  return `${label.slice(0, 9)}…`;
}

function linkLabelPosition(linkData: SimLink, offset = 14) {
  const source = linkData.source as GraphNode;
  const target = linkData.target as GraphNode;
  const sx = source.x ?? 0;
  const sy = source.y ?? 0;
  const tx = target.x ?? 0;
  const ty = target.y ?? 0;
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return {
    x: mx - (dy / len) * offset,
    y: my + (dx / len) * offset,
  };
}

function linkPath(linkData: SimLink): string {
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

function setGraphMode(mode: GraphMode) {
  graphMode.value = mode;
}

function renderGraph() {
  const container = containerRef.value;
  const svgEl = svgRef.value;
  if (!container || !svgEl) {
    return;
  }

  const width = container.clientWidth || 800;
  const { nodes, links } = toSimulationData(graphData.value.links);
  const isIdentity = graphMode.value === 'identity';
  const height = graphHeight(nodes.length);
  initializeNodePositions(nodes, width, height, links.length);

  const svg = d3.select(svgEl);
  svg.selectAll('*').remove();
  svg.attr('viewBox', `0 0 ${width} ${height}`).style('height', `${height}px`);

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

  if (isIdentity) {
    defs
      .append('marker')
      .attr('id', 'graph-arrow')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 24)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', '#0d9488');
  }

  const nodeGradient = defs
    .append('linearGradient')
    .attr('id', 'node-gradient-default')
    .attr('x1', '0%')
    .attr('y1', '0%')
    .attr('x2', '100%')
    .attr('y2', '100%');
  nodeGradient.append('stop').attr('offset', '0%').attr('stop-color', '#f0fdfa');
  nodeGradient.append('stop').attr('offset', '100%').attr('stop-color', '#99f6e4');

  const selectedGradient = defs
    .append('linearGradient')
    .attr('id', 'node-gradient-selected')
    .attr('x1', '0%')
    .attr('y1', '0%')
    .attr('x2', '100%')
    .attr('y2', '100%');
  selectedGradient.append('stop').attr('offset', '0%').attr('stop-color', '#14b8a6');
  selectedGradient.append('stop').attr('offset', '100%').attr('stop-color', '#0f766e');

  const shadow = defs
    .append('filter')
    .attr('id', 'node-shadow')
    .attr('x', '-50%')
    .attr('y', '-50%')
    .attr('width', '200%')
    .attr('height', '200%');
  shadow
    .append('feDropShadow')
    .attr('dx', 0)
    .attr('dy', 2)
    .attr('stdDeviation', 3)
    .attr('flood-opacity', 0.18);

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
        .forceLink<GraphNode, SimLink>(links)
        .id((node) => node.id)
        .distance(linkDistance(nodes.length, isIdentity))
        .strength(isIdentity ? 0.42 : 0.38)
    )
    .force('charge', d3.forceManyBody().strength(chargeStrength(nodes.length)))
    .force('center', d3.forceCenter(width / 2, height / 2).strength(0.08))
    .force(
      'collide',
      d3
        .forceCollide<GraphNode>()
        .radius((node) => nodeCollideRadius(node))
        .strength(0.92)
        .iterations(3)
    )
    .alpha(0.92)
    .alphaDecay(0.028)
    .velocityDecay(0.42);

  const linkGroup = zoomLayer.append('g').attr('class', 'links');

  const link = linkGroup
    .selectAll<SVGPathElement, SimLink>('path')
    .data(links)
    .join('path')
    .attr('fill', 'none')
    .attr('stroke', isIdentity ? '#14b8a6' : '#5eead4')
    .attr('stroke-opacity', 0.85)
    .attr('stroke-width', (linkData) =>
      isIdentity ? 2 : Math.min(6, 1.2 + linkData.strength * 0.8)
    )
    .attr('stroke-linecap', 'round')
    .attr('marker-end', isIdentity ? 'url(#graph-arrow)' : null);

  link.append('title').text((linkData) => linkData.tooltip);

  const linkBadgeData = links.filter((item) =>
    isIdentity ? Boolean(item.label) : item.strength > 1
  );

  const linkBadge = linkGroup
    .selectAll<SVGGElement, SimLink>('g.link-badge')
    .data(linkBadgeData)
    .join('g')
    .attr('class', 'link-badge')
    .attr('pointer-events', 'none');

  linkBadge
    .append('rect')
    .attr('class', 'link-badge-bg')
    .attr('rx', 4)
    .attr('ry', 4)
    .attr('fill', 'rgb(255 255 255 / 92%)')
    .attr('stroke', '#99f6e4')
    .attr('stroke-width', 1);

  linkBadge
    .append('text')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('font-size', isIdentity ? 11 : 10)
    .attr('font-weight', 600)
    .attr('fill', '#0f766e')
    .text((linkData) => formatLinkLabel(linkData.label));

  linkBadge.append('title').text((linkData) => linkData.label);

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

  node.append('title').text((nodeData) => nodeData.name);

  node
    .append('circle')
    .attr('class', 'node-halo')
    .attr('r', (nodeData) => nodeRadius(nodeData) + 6)
    .attr('fill', 'none')
    .attr('stroke', '#14b8a6')
    .attr('stroke-width', 2)
    .attr('opacity', (nodeData) => (nodeData.id === props.selectedPersonaId ? 0.85 : 0));

  node
    .append('circle')
    .attr('class', 'node-circle')
    .attr('r', (nodeData) => nodeRadius(nodeData))
    .attr('fill', (nodeData) =>
      nodeData.id === props.selectedPersonaId
        ? 'url(#node-gradient-selected)'
        : 'url(#node-gradient-default)'
    )
    .attr('stroke', (nodeData) => (nodeData.id === props.selectedPersonaId ? '#115e59' : '#0d9488'))
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
    .attr('fill', (nodeData) => (nodeData.id === props.selectedPersonaId ? '#fff' : '#0f766e'))
    .attr('pointer-events', 'none');

  node
    .append('text')
    .attr('class', 'node-label')
    .text((nodeData) => formatNodeLabel(nodeData.name))
    .attr('y', (nodeData) => nodeRadius(nodeData) + 20)
    .attr('text-anchor', 'middle')
    .attr('font-size', 12)
    .attr('font-weight', (nodeData) => (nodeData.id === props.selectedPersonaId ? 700 : 500))
    .attr('fill', '#134e4a')
    .attr('pointer-events', 'none');

  simulation.on('tick', () => {
    link.attr('d', linkPath);

    linkBadge.attr('transform', (linkData) => {
      const { x, y } = linkLabelPosition(linkData);
      return `translate(${x},${y})`;
    });

    linkBadge.each(function () {
      const group = d3.select(this);
      const textNode = group.select('text').node() as SVGTextElement | null;
      const rect = group.select('rect');
      if (!textNode) {
        return;
      }
      const bbox = textNode.getBBox();
      rect
        .attr('x', bbox.x - 5)
        .attr('y', bbox.y - 3)
        .attr('width', bbox.width + 10)
        .attr('height', bbox.height + 6);
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
  () => [
    props.personas,
    props.relationEvents,
    props.identityRelations,
    props.selectedPersonaId,
    graphMode.value,
    chapterFrom.value,
    chapterTo.value,
    keyword.value,
  ],
  () => renderGraph()
);
</script>

<template>
  <div ref="containerRef" class="graph-panel">
    <div class="graph-header">
      <div class="graph-header-main">
        <h4 class="graph-title">角色关系图</h4>
        <p class="graph-desc">{{ graphDesc }}</p>
      </div>
      <div class="graph-stats">
        <span class="stat-chip">{{ graphStats.nodeCount }} 角色</span>
        <span class="stat-chip">{{ graphStats.linkCount }} 连线</span>
      </div>
    </div>

    <div class="graph-mode-switch" role="tablist" aria-label="关系图视图">
      <button
        type="button"
        class="mode-button"
        :class="{ active: graphMode === 'identity' }"
        role="tab"
        :aria-selected="graphMode === 'identity'"
        @click="setGraphMode('identity')"
      >
        身份关系
      </button>
      <button
        type="button"
        class="mode-button"
        :class="{ active: graphMode === 'events' }"
        role="tab"
        :aria-selected="graphMode === 'events'"
        @click="setGraphMode('events')"
      >
        剧情事件
      </button>
    </div>

    <div v-if="graphMode === 'events'" class="graph-toolbar">
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
        <p class="overlay-desc">请先在人物清单中新增人物。</p>
      </div>
      <div v-else-if="showNoRelationHint" class="graph-overlay graph-overlay--muted">
        <p class="overlay-title">暂无关系连线</p>
        <p class="overlay-desc">{{ noRelationHint }}</p>
      </div>
      <div class="graph-legend" aria-hidden="true">
        <span class="legend-item"><span class="legend-dot legend-dot--default" />人物</span>
        <span class="legend-item"><span class="legend-dot legend-dot--selected" />已选中</span>
        <span v-if="graphMode === 'identity'" class="legend-item"
          ><span class="legend-line legend-line--directed" />身份关系</span
        >
        <span v-else class="legend-item"><span class="legend-line" />剧情事件</span>
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

.graph-mode-switch {
  display: inline-flex;
  gap: 0.25rem;
  padding: 0.2rem;
  margin-bottom: 0.85rem;
  border-radius: var(--aq-radius-xs);
  background: var(--aq-surface-muted);
  border: 1px solid var(--aq-border);
}

.mode-button {
  border: none;
  background: transparent;
  color: var(--aq-text-secondary);
  border-radius: calc(var(--aq-radius-xs) - 2px);
  padding: 0.4rem 0.85rem;
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition:
    background var(--aq-transition),
    color var(--aq-transition);
}

.mode-button.active {
  background: var(--aq-surface);
  color: var(--aq-primary-hover);
  box-shadow: var(--aq-shadow-sm);
  font-weight: 600;
}

.mode-button:focus-visible {
  outline: 2px solid var(--aq-primary);
  outline-offset: 1px;
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
  transition:
    border-color var(--aq-transition),
    box-shadow var(--aq-transition);
}

.toolbar-input--wide {
  width: 100%;
  min-width: 0;
}

.toolbar-input:focus {
  outline: none;
  border-color: var(--aq-primary);
  box-shadow: var(--aq-ring);
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
  min-height: 560px;
  height: clamp(560px, 62vh, 760px);
  border-radius: var(--aq-radius-xs);
  border: 1px solid var(--aq-border);
  background: linear-gradient(180deg, #fafaf8 0%, #f0fdfa 100%);
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
  border: 1.5px solid var(--aq-primary);
  background: var(--aq-primary-soft);
}

.legend-dot--selected {
  border-color: var(--aq-primary-hover);
  background: var(--aq-primary);
}

.legend-line {
  width: 1rem;
  height: 0;
  border-top: 2px solid var(--aq-primary-muted);
}

.legend-line--directed {
  border-top-color: var(--aq-secondary, #14b8a6);
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
