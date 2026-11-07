import { Tool, ToolDefinition, ToolCall, ToolResult, ToolInfoCard, ToolContext } from "./types";
import { getLocale, type Locale } from "@/lib/app";
import { webSearchTool } from "./web-search";
import { effectTool, getPendingEffect, clearPendingEffect } from "./effects";
import { discordShareTool } from "./discord-share";
import { seeCameraTool } from "./see-camera";

export type { Tool, ToolDefinition, ToolCall, ToolResult, ToolInfoCard, ToolContext };
export { getPendingEffect, clearPendingEffect };

// Note: see_camera is first to prioritize visual queries about the user
const tools: Tool[] = [seeCameraTool, webSearchTool, effectTool, discordShareTool];

// For the LLM, when it calls a tool that doesn't exist
const NOT_FOUND: Record<Locale, (name: string) => string> = {
  en: (name) => `Tool "${name}" not found.`,
  ja: (name) => `ツール「${name}」が見つかりません。`,
};

export function getToolDefinitions(): ToolDefinition[] {
  return tools.map((t) => t.definition);
}

export function getTool(name: string): Tool | undefined {
  return tools.find((t) => t.definition.name === name);
}

export async function executeTool(call: ToolCall, context?: ToolContext): Promise<ToolResult> {
  const tool = getTool(call.name);

  if (!tool) {
    return {
      name: call.name,
      result: NOT_FOUND[getLocale()](call.name),
    };
  }

  const execResult = await tool.execute(call.arguments, context);

  // Handle both string and ToolExecuteResult return types
  if (typeof execResult === "string") {
    return {
      name: call.name,
      result: execResult,
    };
  }

  return {
    name: call.name,
    result: execResult.result,
    infoCard: execResult.infoCard,
  };
}
