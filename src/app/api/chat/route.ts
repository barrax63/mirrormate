import { NextRequest, NextResponse } from "next/server";
import { getAllContexts, initializeFeatures } from "@/lib/features/registry";
import { getLLMProvider, ChatMessage } from "@/lib/llm";
import { getFallbackReply, getSystemPrompt, getSystemPromptForCharacter } from "@/lib/character";
import { getToolDefinitions, executeTool, getPendingEffect, clearPendingEffect, ToolInfoCard, ToolContext } from "@/lib/tools";
import { executeRule, formatRuleContext } from "@/lib/rules";
import { loadProvidersConfig, getEmbeddingProvider } from "@/lib/providers";
import { RAGService, getSimpleContext, MemoryService } from "@/lib/memory";
import { getUserRepository, getUserSettingsRepository } from "@/lib/repositories";
import { getLocale } from "@/lib/app";
import { historyLimitFrom, trimHistory } from "@/lib/chat/history";
import { serviceErrorResponse } from "@/lib/errors/classify";
import type { Service } from "@/lib/errors/service-error";

const MAX_TOOL_ITERATIONS = 3;
const DEFAULT_USER_ID = "default-user";

// RAG service cache
let ragService: RAGService | null = null;
let memoryService: MemoryService | null = null;

function getRAGService(): RAGService | null {
  if (ragService) return ragService;

  const embeddingProvider = getEmbeddingProvider();
  if (!embeddingProvider) return null;

  ragService = new RAGService(embeddingProvider);
  return ragService;
}

function getMemoryService(): MemoryService | null {
  if (memoryService) return memoryService;

  const config = loadProvidersConfig();
  const memoryConfig = config.providers?.memory;

  if (!memoryConfig?.enabled) return null;

  const embeddingProvider = getEmbeddingProvider();
  const llmProvider = getLLMProvider();

  memoryService = new MemoryService({
    llmProvider,
    embeddingProvider: embeddingProvider || undefined,
    minConfidence: memoryConfig.extraction?.minConfidence ?? 0.5,
    autoExtract: memoryConfig.extraction?.autoExtract ?? true,
  });

  return memoryService;
}

export async function POST(request: NextRequest) {
  try {
    const { messages: requestMessages, userId, characterId, image: requestImage } = await request.json();

    console.log("[Chat] Request received:", {
      messageCount: requestMessages?.length,
      hasImage: !!requestImage,
      imageLength: requestImage ? requestImage.length : 0,
      characterId,
    });

    // Only the most recent part of the conversation goes to the LLM, since each message costs
    const historyLimit = historyLimitFrom(loadProvidersConfig().providers?.llm?.historyLimit);
    const messages = trimHistory<ChatMessage>(requestMessages, historyLimit);
    if (messages.length < requestMessages.length) {
      console.log(`[Chat] Sending the last ${messages.length} of ${requestMessages.length} messages`);
    }

    // Ensure features are initialized (needed for vision)
    initializeFeatures();

    // Determine user ID (use default if not specified)
    const currentUserId = userId || DEFAULT_USER_ID;

    // Create user if not exists
    const userRepo = getUserRepository();
    await userRepo.findOrCreate(currentUserId);

    // With Vision off, a camera frame goes no further, whichever page sent it
    const settings = await getUserSettingsRepository().findOrCreate(currentUserId);
    const image = settings.visionEnabled ? requestImage : undefined;
    if (requestImage && !image) {
      console.log("[Chat] Vision is off, ignoring the camera image");
    }

    // Get the last user message for rule matching
    const lastUserMessage = messages
      .filter((m: { role: string }) => m.role === "user")
      .pop()?.content || "";

    // Check if any keyword rule matches
    const ruleResult = await executeRule(lastUserMessage);
    const ruleContext = formatRuleContext(ruleResult);

    // Build tool context (image will be passed to tools like see_camera)
    const toolContext: ToolContext = {
      image: image || undefined,
    };

    // Build system prompt with contexts (use character-specific prompt if characterId provided)
    const systemPrompt = characterId
      ? getSystemPromptForCharacter(characterId)
      : getSystemPrompt();
    const contexts: string[] = [];

    // Add tool usage hint when camera image is available
    if (image) {
      const isJapanese = getLocale() === "ja";
      contexts.push("[Tool Usage]");
      contexts.push(isJapanese
        ? "ユーザーのカメラ画像が利用可能です。ユーザーの外見や持っているものについて聞かれた場合は、see_cameraツールを使ってください。web_searchは使わないでください。"
        : "User's camera image is available. If asked about the user's appearance or what they're holding, use the see_camera tool. Do not use web_search.");
    }

    // Get RAG context
    let usedMemoryIds: string[] = [];
    const rag = getRAGService();
    const config = loadProvidersConfig();
    const memoryConfig = config.providers?.memory;

    if (rag && memoryConfig?.enabled) {
      try {
        const ragContext = await rag.retrieve(currentUserId, lastUserMessage, {
          topK: memoryConfig.rag?.topK ?? 8,
          threshold: memoryConfig.rag?.threshold ?? 0.3,
        });
        const formattedContext = rag.formatContext(ragContext);
        if (formattedContext) {
          contexts.push(formattedContext);
        }
        usedMemoryIds = ragContext.usedMemoryIds;
      } catch (error) {
        console.error("[Chat] RAG retrieval failed:", error);
        // Fall back to simple context if RAG fails
        const simpleContext = await getSimpleContext(currentUserId);
        if (simpleContext) {
          contexts.push(simpleContext);
        }
      }
    }

    // Add rule context if matched (takes priority)
    if (ruleContext) {
      contexts.push(ruleContext);
    } else {
      // Use regular plugin context if no rule matched
      const pluginContext = await getAllContexts();
      if (pluginContext) {
        contexts.push("[Current Information]");
        contexts.push(pluginContext);
      }
    }

    const systemPromptWithContext = contexts.length > 0
      ? `${systemPrompt}\n\n${contexts.join("\n")}`
      : systemPrompt;

    const llmProvider = getLLMProvider();

    // Only provide tools if no rule matched (rule already handled the data gathering)
    const tools = ruleResult.matched ? [] : getToolDefinitions();

    let chatMessages: ChatMessage[] = [
      { role: "system", content: systemPromptWithContext },
      ...messages,
    ];

    let assistantMessage = "";
    let iterations = 0;
    let discordShared = false;
    let toolsUsed = false;
    const infoCards: ToolInfoCard[] = [];

    // Clear any pending effects from previous requests
    clearPendingEffect();

    // Tool calling loop
    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      const result = await llmProvider.chat({
        messages: chatMessages,
        tools: tools.length > 0 ? tools : undefined,
      });

      if (result.finishReason === "stop" || !result.toolCalls || result.toolCalls.length === 0) {
        assistantMessage = result.content;
        break;
      }

      // Process tool calls
      console.log(`[Chat] Processing ${result.toolCalls.length} tool call(s)`);
      toolsUsed = true;

      // Add assistant message with tool calls
      chatMessages.push({
        role: "assistant",
        content: result.content || "",
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id || `call_${Date.now()}`,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      });

      // Execute tools and add results
      for (const toolCall of result.toolCalls) {
        console.log(`[Chat] Executing tool: ${toolCall.name}`);
        const toolResult = await executeTool(toolCall, toolContext);

        // Collect info cards from tools
        if (toolResult.infoCard) {
          infoCards.push(toolResult.infoCard);
          // Track Discord share via info card
          if (toolResult.infoCard.type === "discord") {
            discordShared = true;
          }
        }

        chatMessages.push({
          role: "tool",
          content: toolResult.result,
          tool_call_id: toolCall.id || `call_${Date.now()}`,
        });
      }
    }

    // No text, such as when tools were still being called at the limit, leaves the avatar
    // silent. One more call, without tools, so the LLM can only answer.
    if (!assistantMessage.trim()) {
      console.warn(`[Chat] No reply text after ${iterations} LLM call(s), asking once more without tools`);
      const result = await llmProvider.chat({ messages: chatMessages });
      assistantMessage = result.content;
    }

    // Still nothing: the character's line from the locale's character.yaml
    const usedFallback = !assistantMessage.trim();
    if (usedFallback) {
      console.warn("[Chat] The LLM gave no reply text again, using the fallback line");
      assistantMessage = getFallbackReply();
    }

    // Determine effect: tool-triggered effect takes priority, then rule effect
    const toolEffect = getPendingEffect();
    const effect = toolEffect || ruleResult.effect;

    // Record memory usage & async memory extraction
    const memService = getMemoryService();
    if (memService && usedMemoryIds.length > 0) {
      // Update lastUsedAt for used memories (async)
      memService.touchMemories(usedMemoryIds).catch((err) => {
        console.error("[Chat] Failed to touch memories:", err);
      });
    }

    // Extract memories from conversation (async, non-blocking). Not after the fallback line,
    // which isn't the LLM's reply to it.
    if (memService && !usedFallback) {
      const conversationMessages = messages
        .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
        .slice(-10) // Use last 10 messages for extraction
        .map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

      // Add assistant response
      conversationMessages.push({
        role: "assistant" as const,
        content: assistantMessage,
      });

      memService.processConversation(currentUserId, conversationMessages, usedMemoryIds).catch((err) => {
        console.error("[Chat] Memory extraction failed:", err);
      });
    }

    return NextResponse.json({
      message: assistantMessage,
      effect,
      discordShared,
      toolsUsed,
      infoCards,
      // So the pages trim what they keep the same way
      historyLimit,
    });
  } catch (error) {
    return serviceErrorResponse(error, "Chat API", llmService());
  }
}

/** The LLM's backend, which a failed fetch here was most likely on its way to */
function llmService(): Service | undefined {
  try {
    return loadProvidersConfig().providers?.llm?.provider === "ollama" ? "ollama" : "openai";
  } catch {
    // The config itself may be what failed
    return undefined;
  }
}
