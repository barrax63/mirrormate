import OpenAI from "openai";
import { LLMProvider, ChatCompletionOptions, ChatCompletionResult, ChatMessage } from "./types";
import { ToolCall } from "../tools/types";

export interface OpenAIConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  private defaultMaxTokens: number;
  private defaultTemperature: number;

  constructor(config: OpenAIConfig = {}) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.model = config.model || "gpt-6-luna";
    this.defaultMaxTokens = config.maxTokens || 300;
    this.defaultTemperature = config.temperature || 0.7;
  }

  private convertMessages(messages: ChatMessage[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      if (msg.role === "tool") {
        return {
          role: "tool" as const,
          content: msg.content,
          tool_call_id: msg.tool_call_id || "",
        };
      }
      if (msg.role === "assistant" && msg.tool_calls) {
        return {
          role: "assistant" as const,
          content: msg.content || null,
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: tc.function,
          })),
        };
      }
      return {
        role: msg.role as "system" | "user" | "assistant",
        content: msg.content,
      };
    });
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const requestParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: this.convertMessages(options.messages),
      // Tools and temperature are only accepted with reasoning off. Older models without
      // reasoning reject this parameter.
      reasoning_effort: "none",
      // The API rejects max_tokens
      max_completion_tokens: options.maxTokens || this.defaultMaxTokens,
      temperature: options.temperature || this.defaultTemperature,
    };

    if (options.tools && options.tools.length > 0) {
      requestParams.tools = options.tools.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
    }

    const completion = await this.client.chat.completions.create(requestParams);
    const choice = completion.choices[0];
    const message = choice?.message;

    if (choice?.finish_reason === "tool_calls" && message?.tool_calls) {
      // Only function tools are defined, so other kinds of calls can't occur
      const toolCalls: ToolCall[] = message.tool_calls.flatMap((tc) =>
        tc.type === "function"
          ? [{ id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments) }]
          : []
      );

      return {
        content: message.content || "",
        toolCalls,
        finishReason: "tool_calls",
      };
    }

    if (choice?.finish_reason === "length") {
      console.warn(`[OpenAI] Reply cut off at ${requestParams.max_completion_tokens} tokens`);
    }

    return {
      content: message?.content || "",
      finishReason: choice?.finish_reason === "length" ? "length" : "stop",
    };
  }
}
