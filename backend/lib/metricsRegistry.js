const DEFAULT_HEALTH_STATUS = { healthy: true, detail: null, updatedAt: null };

class MetricsRegistry {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.health = new Map();
  }

  incrementCounter(name, value = 1) {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }

  setCounter(name, value) {
    this.counters.set(name, Number(value) || 0);
  }

  setGauge(name, value) {
    this.gauges.set(name, Number(value) || 0);
  }

  setHealthStatus(name, { healthy, detail } = {}) {
    this.health.set(name, {
      healthy: healthy !== false,
      detail: detail || null,
      updatedAt: new Date().toISOString(),
    });
  }

  getSnapshot() {
    const counters = {};
    const gauges = {};
    const health = {};

    for (const [key, value] of this.counters.entries()) {
      counters[key] = value;
    }

    for (const [key, value] of this.gauges.entries()) {
      gauges[key] = value;
    }

    for (const [key, status] of this.health.entries()) {
      health[key] = {
        healthy: status.healthy,
        detail: status.detail,
        updatedAt: status.updatedAt,
      };
    }

    return {
      timestamp: new Date().toISOString(),
      counters,
      gauges,
      health,
    };
  }

  getHealthSummary() {
    const snapshot = this.getSnapshot();
    let overallHealthy = true;
    for (const entry of Object.values(snapshot.health)) {
      if (!entry.healthy) {
        overallHealthy = false;
        break;
      }
    }
    return {
      healthy: overallHealthy,
      components: snapshot.health,
      timestamp: snapshot.timestamp,
    };
  }

  toPrometheus() {
    const snapshot = this.getSnapshot();
    const lines = [];
    const sanitize = (name) => String(name || "metric").replace(/[^a-zA-Z0-9_]/g, "_");

    for (const [key, value] of Object.entries(snapshot.counters || {})) {
      const metric = sanitize(`app_${key}`);
      lines.push(`# TYPE ${metric} counter`);
      lines.push(`${metric} ${Number(value) || 0}`);
    }

    for (const [key, value] of Object.entries(snapshot.gauges || {})) {
      const metric = sanitize(`app_${key}`);
      lines.push(`# TYPE ${metric} gauge`);
      lines.push(`${metric} ${Number(value) || 0}`);
    }

    for (const [component, status] of Object.entries(snapshot.health || {})) {
      const metric = sanitize(`component_${component}_healthy`);
      const labels = [`component="${component}"`];
      if (status.detail) {
        labels.push(`detail="${String(status.detail).replace(/"/g, '\"')}"`);
      }
      lines.push(`# TYPE ${metric} gauge`);
      lines.push(`${metric}{${labels.join(",")}} ${status.healthy ? 1 : 0}`);
    }

    lines.push(`# TYPE app_metrics_timestamp gauge`);
    lines.push(`app_metrics_timestamp ${Date.parse(snapshot.timestamp) / 1000 || 0}`);

    return `${lines.join("\n")}\n`;
  }
}

const metricsRegistry = new MetricsRegistry();

module.exports = {
  metricsRegistry,
};
