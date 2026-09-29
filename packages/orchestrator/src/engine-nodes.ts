/**
 * بناء عقد الرسم البياني — مصنع العقد الثماني للمنسق.
 *
 * ماهيتها: تجميع كل عقدة DAG (تحميل→تطبيع→تحليل→تصميم→توليد→تحصين→تقييم→شهادة)
 * بمعزل عن حلقة المحرك — فلا يتجاوز engine.ts حد الـ200 سطر.
 * وظيفتها: تستقبل سياق التشغيل وخيارات المنسق وتعيد خريطة StageId→PipelineNode جاهزة.
 * كيف: دوال نقية تبني كل عقدة بدالة مصنعها المستقلة — idempotent حصراً.
 */

import type { StageId } from "@agentbridge/shared";
import type { PipelineNode } from "./graph.js";
import { PipelineContext } from "./context-store.js";
import type { OrchestratorOptions } from "./contracts.js";
import { createAnalyzeNode, createLoadSpecNode, createNormalizeNode } from "./nodes/basic-nodes.js";
import { createDesignToolsNode } from "./nodes/design-tools-node.js";
import { createGenerateServerNode } from "./nodes/generate-server-node.js";
import { createHardenNode } from "./nodes/harden-node.js";
import { createEvaluateNode } from "./nodes/evaluate-node.js";
import { createCertifyNode } from "./nodes/certify-node.js";

/**
 * يبني خريطة العقد الثماني مرتبة حسب EXECUTION_ORDER المنطقي.
 */
export function buildNodes(context: PipelineContext, options: OrchestratorOptions): ReadonlyMap<StageId, PipelineNode> {
  const list: readonly PipelineNode[] = [
    createLoadSpecNode(context, { rawSpec: options.rawSpec }),
    createNormalizeNode(context),
    createAnalyzeNode(context),
    createDesignToolsNode(context, options.provider, options.flywheel),
    createGenerateServerNode(context),
    createHardenNode(context, options.provider, options.harden),
    createEvaluateNode(context, options.provider),
    createCertifyNode(context, options.certificateSigning),
  ];
  return new Map(list.map((node) => [node.stage, node]));
}
