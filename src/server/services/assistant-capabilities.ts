/** 应用根装配唯一业务能力；助手不反向加载协议或应用注册表。 */
import type { ToolDef } from "../application/capabilities/tools.ts";
let capabilities: readonly ToolDef[] | undefined;
export function installAssistantCapabilities(value: readonly ToolDef[]): void { capabilities = value; }
export function assistantCapabilities(): readonly ToolDef[] {
  if (!capabilities) throw new Error("Assistant capabilities must be installed by the application root");
  return capabilities;
}
