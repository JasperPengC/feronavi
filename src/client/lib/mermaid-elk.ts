import ELK, { type ELKConstructorArguments, type ElkLayoutArguments, type ElkNode } from "elkjs/lib/elk-api.js";
import workerUrl from "elkjs/lib/elk-worker.min.js?url";

/** 保留全部ELK布局算法，按需加载独立Worker，避免布局计算阻塞页面。 */
export default class MermaidELK extends ELK {
  constructor(options: ELKConstructorArguments = {}) {
    super({ ...options, workerUrl });
  }

  override async layout<T extends ElkNode>(graph: T, options?: ElkLayoutArguments) {
    // Mermaid节点附带主线程绘制函数和DOM引用；ELK只接收JSON图数据。
    try {
      const data = JSON.parse(JSON.stringify(graph, (_key, value) => typeof value === "function" || value instanceof Node ? undefined : value)) as T;
      return await super.layout(data, options);
    }
    finally { this.terminateWorker(); }
  }
}
