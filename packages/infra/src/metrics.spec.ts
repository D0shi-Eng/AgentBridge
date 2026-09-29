/**
 * اختبارات MetricsRegistry — وحدة حتمية بلا تبعيات.
 */

import { describe, expect, it } from "vitest";
import { MetricsRegistry } from "./metrics.js";

describe("MetricsRegistry", () => {
  it("inc يزيد العدّاد بمفتاح مركب مرتب", () => {
    const registry = new MetricsRegistry();
    registry.inc("http_requests_total", { method: "GET", route: "/health", status: "200" });
    registry.inc("http_requests_total", { method: "GET", route: "/health", status: "200" });
    registry.inc("http_requests_total", { method: "POST", route: "/pipelines", status: "202" });
    const snap = registry.snapshot();
    expect(snap.counters['http_requests_total{method="GET",route="/health",status="200"}']).toBe(2);
    expect(snap.counters['http_requests_total{method="POST",route="/pipelines",status="202"}']).toBe(1);
  });

  it("histogram يجمع sum/count/avg", () => {
    const registry = new MetricsRegistry();
    registry.histogramObserve("http_request_duration_ms", 10);
    registry.histogramObserve("http_request_duration_ms", 20);
    registry.histogramObserve("http_request_duration_ms", 30);
    const snap = registry.snapshot();
    expect(snap.histograms["http_request_duration_ms"]?.sum).toBe(60);
    expect(snap.histograms["http_request_duration_ms"]?.count).toBe(3);
    expect(snap.histograms["http_request_duration_ms"]?.avg).toBe(20);
  });

  it("snapshot يعيد نسخاً حتمية و toPrometheus نصاً", () => {
    const registry = new MetricsRegistry();
    registry.inc("a", {});
    registry.histogramObserve("h", 5);
    const prom = registry.toPrometheus();
    expect(prom).toContain("a 1");
    expect(prom).toContain("h_sum 5");
    expect(prom).toContain("h_count 1");
  });

  it("registry فارغ يعيد لقطة صفرية", () => {
    const registry = new MetricsRegistry();
    const snap = registry.snapshot();
    expect(Object.keys(snap.counters).length).toBe(0);
    expect(Object.keys(snap.histograms).length).toBe(0);
  });
});
