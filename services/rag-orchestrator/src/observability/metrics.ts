import { MetricsSnapshot } from './types';

class MetricsCollector {
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, { count: number; sum: number; min: number; max: number }> =
    new Map();
  private startTime = Date.now();

  private key(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) return name;
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join(',');
    return `${name}{${labelStr}}`;
  }

  increment(name: string, labels?: Record<string, string>, value = 1): void {
    const k = this.key(name, labels);
    this.counters.set(k, (this.counters.get(k) || 0) + value);
  }

  observe(name: string, value: number, labels?: Record<string, string>): void {
    const k = this.key(name, labels);
    const existing = this.histograms.get(k) || { count: 0, sum: 0, min: Infinity, max: -Infinity };
    existing.count += 1;
    existing.sum += value;
    existing.min = Math.min(existing.min, value);
    existing.max = Math.max(existing.max, value);
    this.histograms.set(k, existing);
  }

  recordLatency(name: string, durationMs: number, labels?: Record<string, string>): void {
    this.observe(name, durationMs, labels);
  }

  getSnapshot(activeSpans: number, totalTraces: number): MetricsSnapshot {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters.entries()) {
      counters[k] = v;
    }

    const histograms: Record<string, { count: number; sum: number; min: number; max: number }> = {};
    for (const [k, v] of this.histograms.entries()) {
      histograms[k] = v;
    }

    return {
      counters,
      histograms,
      activeSpans,
      totalTraces,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.startTime = Date.now();
  }
}

export const metrics = new MetricsCollector();
