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
    const haystack = [event.protagonist, event.counterparty, event.summary].join(' ').toLowerCase();
    return haystack.includes(key);
  });
});

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

  const zoomLayer = svg.append('g');
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.4, 2.5])
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
        .distance(140)
        .strength(0.5)
    )
    .force('charge', d3.forceManyBody().strength(-320))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collide', d3.forceCollide().radius(36));

  const link = zoomLayer
    .append('g')
    .attr('stroke', '#cbd5e1')
    .attr('stroke-opacity', 0.9)
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke-width', (linkData) => Math.min(8, 1 + linkData.eventCount));

  const node = zoomLayer
    .append('g')
    .selectAll<SVGGElement, GraphNode>('g')
    .data(nodes)
    .join('g')
    .attr('cursor', 'pointer')
    .on('click', (_, nodeData) => emit('selectPersona', nodeData.id));

  const dragBehavior = d3
    .drag<SVGGElement, GraphNode>()
    .on('start', (event, nodeData) => {
      if (!event.active) {
        simulation?.alphaTarget(0.3).restart();
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
    .attr('r', (nodeData) => Math.min(28, 10 + nodeData.eventCount * 2))
    .attr('fill', (nodeData) => (nodeData.id === props.selectedPersonaId ? '#4f46e5' : '#93c5fd'))
    .attr('stroke', '#1e3a8a')
    .attr('stroke-width', 1.5);

  node
    .append('text')
    .text((nodeData) => nodeData.name)
    .attr('x', 0)
    .attr('y', 4)
    .attr('text-anchor', 'middle')
    .attr('font-size', 12)
    .attr('fill', '#0f172a');

  link.append('title').text((linkData) => linkData.summary);

  simulation.on('tick', () => {
    link
      .attr('x1', (linkData) => (linkData.source as GraphNode).x ?? 0)
      .attr('y1', (linkData) => (linkData.source as GraphNode).y ?? 0)
      .attr('x2', (linkData) => (linkData.target as GraphNode).x ?? 0)
      .attr('y2', (linkData) => (linkData.target as GraphNode).y ?? 0);

    node.attr('transform', (nodeData) => `translate(${nodeData.x ?? 0},${nodeData.y ?? 0})`);
  });

  const hintEl = container.querySelector('.graph-hint');
  if (hintEl) {
    hintEl.textContent = nodes.length > 50 ? '节点较多，建议使用章节范围或角色名筛选' : '';
  }
}

onMounted(() => {
  renderGraph();
  window.addEventListener('resize', renderGraph);
});

onBeforeUnmount(() => {
  simulation?.stop();
  window.removeEventListener('resize', renderGraph);
});

watch(
  () => [props.personas, props.relationEvents, filteredEvents.value, props.selectedPersonaId],
  () => renderGraph()
);
</script>

<template>
  <div ref="containerRef" class="graph-panel">
    <div class="graph-toolbar">
      <label>
        章节从
        <input v-model="chapterFrom" class="field-input" type="number" min="1" placeholder="1" />
      </label>
      <label>
        到
        <input v-model="chapterTo" class="field-input" type="number" min="1" placeholder="∞" />
      </label>
      <label>
        角色名
        <input v-model="keyword" class="field-input" type="text" placeholder="搜索定位" />
      </label>
    </div>
    <svg ref="svgRef" class="graph-svg" role="img" aria-label="角色关系力导向图" />
    <p class="graph-hint" />
  </div>
</template>

<style scoped>
.graph-panel {
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  background: #fff;
  padding: 1rem;
}

.graph-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.graph-toolbar label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.9rem;
}

.field-input {
  width: 88px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0.35rem 0.5rem;
}

.graph-svg {
  width: 100%;
  height: 520px;
  border: 1px dashed #e5e7eb;
  border-radius: 12px;
  background: #f8fafc;
}

.graph-hint {
  margin-top: 0.5rem;
  color: #6b7280;
  font-size: 0.85rem;
  min-height: 1.2rem;
}
</style>
