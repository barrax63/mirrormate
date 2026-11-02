import { ToolDefinition, ToolCall } from "../tools/types";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    function: {
      name: string;
      arguments: string;
    };
  }[];
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface ChatCompletionResult {
  content: string;
  toolCalls?: ToolCall[];
  /** "length" means the reply was cut off at maxTokens */
  finishReason: "stop" | "tool_calls" | "length";
}

export interface StreamChunk {
  content: string;
  done: boolean;
  toolCalls?: ToolCall[];
  finishReason?: "stop" | "tool_calls" | "length";
}

export interface LLMProvider {
  chat(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
  chatStream?(options: ChatCompletionOptions): AsyncGenerator<StreamChunk>;
}
