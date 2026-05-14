/**
 * Graph RAG Agent Factory
 *
 * Creates a LangChain agent configured for code graph analysis.
 * Supports Azure OpenAI and Google Gemini providers.
 */

import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from '@langchain/core/messages';
import { ChatOpenAI, AzureChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/ollama';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createGraphRAGTools, type GraphRAGBackend } from './tools';
import type {
  ProviderConfig,
  OpenAIConfig,
  AzureOpenAIConfig,
  GeminiConfig,
  AnthropicConfig,
  OllamaConfig,
  OpenRouterConfig,
  MiniMaxConfig,
  GLMConfig,
  DeepSeekConfig,
  AgentStreamChunk,
} from './types';
import { type CodebaseContext, buildDynamicSystemPrompt } from './context-builder';
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OPENROUTER_BASE_URL } from '../../config/ui-constants';

/**
 * System prompt for the Graph RAG agent
 *
 * Design principles (based on Aider/Cline research):
 * - Short, punchy directives > long explanations
 * - No template-inducing examples
 * - Let LLM figure out HOW, just tell it WHAT behavior we want
 * - Explicit progress reporting requirement
 * - Anti-laziness directives
 */
/**
 * Base system prompt - exported so it can be used with dynamic context injection
 *
 * Structure (optimized for instruction following):
 * 1. Identity + GROUNDING mandate (most important)
 * 2. Core protocol (how to work)
 * 3. Tools reference
 * 4. Output format & rules
 * 5. [Dynamic context appended at end]
 */
export const BASE_SYSTEM_PROMPT = `You are Nexus, a Code Analysis Agent with access to a Knowledge Graph. Your responses MUST be grounded.

## ⚠️ MANDATORY: GROUNDING
Every factual claim MUST include a citation.
- File refs: [[src/auth.ts:45-60]] (line range with hyphen)
- NO citation = NO claim. Say "I didn't find evidence" instead of guessing.

## ⚠️ MANDATORY: VALIDATION
Every output MUST be validated.
- Use cypher to validate the results and confirm completeness of context before final output.
- NO validation = NO claim. Say "I didn't find evidence" instead of guessing.
- Do not blindly trust readme or single source of truth. Always validate and cross-reference. Never be lazy.

## 🧠 CORE PROTOCOL
You are an investigator. For each question:
1. **Search** → Use cypher, search or grep to find relevant code
2. **Read** → Use read to see the actual source
3. **Trace** → Use cypher to follow connections in the graph
4. **Cite** → Ground every finding with [[file:line]] or [[Type:Name]]
5. **Validate** → Use cypher to validate the results and confirm completeness of context before final output. ( MUST DO )

## 🛠️ TOOLS
- **\`search\`** — Hybrid search. Results grouped by process with cluster context.
- **\`cypher\`** — Cypher queries against the graph. Use \`{{QUERY_VECTOR}}\` for vector search.
- **\`grep\`** — Regex search. Best for exact strings, TODOs, error codes.
- **\`read\`** — Read file content. Always use after search/grep to see full code.
- **\`explore\`** — Deep dive on a symbol, cluster, or process. Shows membership, participation, connections.
- **\`overview\`** — Codebase map showing all clusters and processes.
- **\`impact\`** — Impact analysis. Shows affected processes, clusters, and risk level.

## 📊 GRAPH SCHEMA
Nodes: File, Folder, Function, Class, Interface, Method, Community, Process
Relations: \`CodeRelation\` with \`type\` property: CONTAINS, DEFINES, IMPORTS, CALLS, EXTENDS, IMPLEMENTS, MEMBER_OF, STEP_IN_PROCESS

## 📐 GRAPH SEMANTICS (Important!)
**Edge Types:**
- \`CALLS\`: Method invocation OR constructor injection. If A receives B as parameter and uses it, A→B is CALLS. This is intentional simplification.
- \`IMPORTS\`: File-level import/include statement.
- \`EXTENDS/IMPLEMENTS\`: Class inheritance.

**Process Nodes:**
- Process labels use format: "EntryPoint → Terminal" (e.g., "onCreate → showToast")
- These are heuristic names from tracing execution flow, NOT application-defined names
- Entry points are detected via export status, naming patterns, and framework conventions

Cypher examples:
- \`MATCH (f:Function) RETURN f.name LIMIT 10\`
- \`MATCH (f:File)-[:CodeRelation {type: 'IMPORTS'}]->(g:File) RETURN f.name, g.name\`

## 📝CRITICAL RULES
- **impact output is trusted.** Do NOT re-validate with cypher. Optionally run the suggested grep commands for dynamic patterns.
- **Cite or retract.** Never state something you can't ground.
- **Read before concluding.** Don't guess from names alone.
- **Retry on failure.** If a tool fails, fix the input and try again.
- **Cyfer tool validation** prefer using cyfer tool in anything that requires graph connections.
- **OUTPUT STYLE** Prefer using tables and mermaid diagrams instead of long explanations.
- ALWAYS USE MERMAID FOR VISUALIZATION AND STRUCTURING THE OUTPUT.

## 🎯 OUTPUT STYLE
Think like a senior architect. Be concise—no fluff, short, precise and to the point.
- Use tables for comparisons/rankings
- Use mermaid diagrams for flows/dependencies
- Surface deep insights: patterns, coupling, design decisions
- End with **TL;DR** (short summary of the response, summing up the response and the most critical parts)

## MERMAID RULES
When generating diagrams:
- NO special characters in node labels: quotes, (), /, &, <, >
- Wrap labels with spaces in quotes: A["My Label"]
- Use simple IDs: A, B, C or auth, db, api
- Flowchart: graph TD or graph LR (not flowchart)
- Always test mentally: would this parse?

BAD:  A[User's Data] --> B(Process & Save)
GOOD: A["User Data"] --> B["Process and Save"]
`;

/**
 * DeepSeek reasoning_content passthrough.
 *
 * DeepSeek thinking-mode models return a `reasoning_content` field alongside
 * `content` in assistant messages. The API requires this field to be passed
 * back on subsequent requests (400 error otherwise).
 *
 * LangChain's completions converter preserves reasoning_content on inbound
 * AIMessages (`additional_kwargs.reasoning_content`) but does NOT pass it
 * through on outbound conversion. We fix this by patching the ChatOpenAI
 * completions instance:
 *
 *   1. Before the converter runs, we save the original LangChain messages
 *      (which have reasoning_content in their additional_kwargs).
 *   2. After the converter produces mapped OpenAI params, we inject
 *      reasoning_content into assistant message params by matching the
 *      message index (1:1 mapping for non-audio models like DeepSeek).
 *
 * The inbound direction needs no fix — LangChain already extracts
 * reasoning_content from API responses into AIMessage.additional_kwargs.
 */
const patchDeepSeekCompletions = (chatModel: ChatOpenAI): void => {
  const completions = (chatModel as any).completions;
  if (!completions) return;
  console.warn('[deepseek] patching completions instance');

  // Shared mutable slot: set by _streamResponseChunks / _generate before the
  // converter runs, read by completionWithRetry after the converter has mapped
  // the messages.
  let currentOriginalMessages: BaseMessage[] | null = null;

  // ----- _streamResponseChunks (streaming path) -----
  const origStreamChunks = completions._streamResponseChunks.bind(completions);
  completions._streamResponseChunks = async function* (
    this: any,
    messages: BaseMessage[],
    options: any,
    runManager: any,
  ) {
    currentOriginalMessages = messages;
    const assistantMsgs = messages.filter(
      (m: any) => (m?.getType?.() ?? m?.constructor?.name === 'AIMessage') || m?.type === 'ai',
    );
    const rcSizes = assistantMsgs.map(
      (m: any) => (m.additional_kwargs || m.kwargs)?.reasoning_content?.length ?? 0,
    );
    console.warn('[deepseek] _streamResponseChunks:', messages.length, 'msgs, rc:', rcSizes);
    try {
      yield* origStreamChunks(messages, options, runManager);
    } finally {
      currentOriginalMessages = null;
    }
  };

  // ----- _generate (non-streaming path, fallback) -----
  const origGenerate = completions._generate.bind(completions);
  completions._generate = async function (
    this: any,
    messages: BaseMessage[],
    options: any,
    runManager: any,
  ) {
    currentOriginalMessages = messages;
    console.warn('[deepseek] _generate:', messages.length, 'msgs');
    try {
      return await origGenerate(messages, options, runManager);
    } finally {
      currentOriginalMessages = null;
    }
  };

  // ----- completionWithRetry (the actual API call) -----
  const origCompletionWithRetry = completions.completionWithRetry.bind(completions);
  completions.completionWithRetry = async function (this: any, request: any, requestOptions: any) {
    if (request.messages && currentOriginalMessages) {
      let injected = 0;
      let skippedDuck = 0;
      let skippedNoRc = 0;
      const hasCurrent = !!currentOriginalMessages;
      console.warn(
        '[deepseek] completionWithRetry: hasCurrent=',
        hasCurrent,
        'reqMsgs=',
        request.messages.length,
        'origMsgs=',
        currentOriginalMessages.length,
      );
      request = {
        ...request,
        messages: request.messages.map((mappedMsg: Record<string, unknown>, i: number) => {
          if (mappedMsg.role !== 'assistant' || i >= currentOriginalMessages!.length) {
            return mappedMsg;
          }
          const orig = currentOriginalMessages![i];
          // AIMessage.isInstance may return false for deserialized messages
          // (LangGraph checkpoints serialize state between turns).
          // Check for the additional_kwargs duck-type instead.
          const ak = (orig as any).additional_kwargs;
          if (!ak || typeof ak !== 'object') {
            skippedDuck++;
            return mappedMsg;
          }
          const rc: string | undefined = ak.reasoning_content as string | undefined;
          if (!rc) {
            skippedNoRc++;
            return mappedMsg;
          }
          injected++;
          return { ...mappedMsg, reasoning_content: rc };
        }),
      };
      console.warn(
        '[deepseek] completionWithRetry result: injected=',
        injected,
        'skippedDuck=',
        skippedDuck,
        'skippedNoRc=',
        skippedNoRc,
      );
    } else {
      console.warn(
        '[deepseek] completionWithRetry SKIP: hasMsgs=',
        !!request.messages,
        'hasCurrent=',
        !!currentOriginalMessages,
      );
    }
    return origCompletionWithRetry(request, requestOptions);
  };
};

export const createChatModel = (config: ProviderConfig): BaseChatModel => {
  switch (config.provider) {
    case 'openai': {
      const openaiConfig = config as OpenAIConfig;

      if (!openaiConfig.apiKey || openaiConfig.apiKey.trim() === '') {
        throw new Error('OpenAI API key is required but was not provided');
      }

      return new ChatOpenAI({
        apiKey: openaiConfig.apiKey,
        modelName: openaiConfig.model,
        temperature: openaiConfig.temperature ?? 0.1,
        maxTokens: openaiConfig.maxTokens,
        configuration: {
          apiKey: openaiConfig.apiKey,
          ...(openaiConfig.baseUrl ? { baseURL: openaiConfig.baseUrl } : {}),
        },
        streaming: true,
      });
    }

    case 'azure-openai': {
      const azureConfig = config as AzureOpenAIConfig;
      return new AzureChatOpenAI({
        azureOpenAIApiKey: azureConfig.apiKey,
        azureOpenAIApiInstanceName: extractInstanceName(azureConfig.endpoint),
        azureOpenAIApiDeploymentName: azureConfig.deploymentName,
        azureOpenAIApiVersion: azureConfig.apiVersion ?? '2024-12-01-preview',
        // Note: gpt-5.2-chat only supports temperature=1 (default)
        streaming: true,
      });
    }

    case 'gemini': {
      const geminiConfig = config as GeminiConfig;
      return new ChatGoogleGenerativeAI({
        apiKey: geminiConfig.apiKey,
        model: geminiConfig.model,
        temperature: geminiConfig.temperature ?? 0.1,
        maxOutputTokens: geminiConfig.maxTokens,
        streaming: true,
      });
    }

    case 'anthropic': {
      const anthropicConfig = config as AnthropicConfig;
      return new ChatAnthropic({
        anthropicApiKey: anthropicConfig.apiKey,
        model: anthropicConfig.model,
        temperature: anthropicConfig.temperature ?? 0.1,
        maxTokens: anthropicConfig.maxTokens ?? 8192,
        streaming: true,
      });
    }

    case 'ollama': {
      const ollamaConfig = config as OllamaConfig;
      return new ChatOllama({
        baseUrl: ollamaConfig.baseUrl ?? DEFAULT_OLLAMA_BASE_URL,
        model: ollamaConfig.model,
        temperature: ollamaConfig.temperature ?? 0.1,
        streaming: true,
        // Allow longer responses (Ollama default is often 128-2048)
        numPredict: 30000,
        // Increase context window (Ollama default is only 2048!)
        // This is critical for agentic workflows with tool calls
        numCtx: 32768,
      });
    }

    case 'openrouter': {
      const openRouterConfig = config as OpenRouterConfig;

      // Debug logging
      if (import.meta.env.DEV) {
        console.log('🌐 OpenRouter config:', {
          hasApiKey: !!openRouterConfig.apiKey,
          model: openRouterConfig.model,
          baseUrl: openRouterConfig.baseUrl,
        });
      }

      if (!openRouterConfig.apiKey || openRouterConfig.apiKey.trim() === '') {
        throw new Error('OpenRouter API key is required but was not provided');
      }

      return new ChatOpenAI({
        openAIApiKey: openRouterConfig.apiKey,
        apiKey: openRouterConfig.apiKey, // Fallback for some versions
        modelName: openRouterConfig.model,
        temperature: openRouterConfig.temperature ?? 0.1,
        maxTokens: openRouterConfig.maxTokens,
        configuration: {
          apiKey: openRouterConfig.apiKey, // Ensure client receives it
          baseURL: openRouterConfig.baseUrl ?? DEFAULT_OPENROUTER_BASE_URL,
        },
        streaming: true,
      });
    }

    case 'minimax': {
      const minimaxConfig = config as MiniMaxConfig;

      if (!minimaxConfig.apiKey || minimaxConfig.apiKey.trim() === '') {
        throw new Error('MiniMax API key is required but was not provided');
      }

      return new ChatAnthropic({
        anthropicApiKey: minimaxConfig.apiKey,
        model: minimaxConfig.model,
        temperature: minimaxConfig.temperature ?? 0.1,
        maxTokens: minimaxConfig.maxTokens ?? 8192,
        streaming: true,
        clientOptions: {
          baseURL: 'https://api.minimax.io/anthropic',
        },
      });
    }

    case 'glm': {
      const glmConfig = config as GLMConfig;

      if (!glmConfig.apiKey || glmConfig.apiKey.trim() === '') {
        throw new Error('GLM API key is required but was not provided');
      }

      return new ChatOpenAI({
        apiKey: glmConfig.apiKey,
        modelName: glmConfig.model,
        temperature: glmConfig.temperature ?? 0.1,
        maxTokens: glmConfig.maxTokens,
        configuration: {
          apiKey: glmConfig.apiKey,
          baseURL: glmConfig.baseUrl ?? 'https://api.z.ai/api/coding/paas/v4',
        },
        streaming: true,
      });
    }

    case 'deepseek': {
      const deepseekConfig = config as DeepSeekConfig;

      if (!deepseekConfig.apiKey || deepseekConfig.apiKey.trim() === '') {
        throw new Error('DeepSeek API key is required but was not provided');
      }

      const model = new ChatOpenAI({
        apiKey: deepseekConfig.apiKey,
        modelName: deepseekConfig.model,
        temperature: deepseekConfig.temperature ?? 0.1,
        maxTokens: deepseekConfig.maxTokens,
        configuration: {
          apiKey: deepseekConfig.apiKey,
          baseURL: 'https://api.deepseek.com',
        },
        streaming: true,
      });
      patchDeepSeekCompletions(model);
      return model;
    }

    default:
      throw new Error(`Unsupported provider: ${(config as any).provider}`);
  }
};

/**
 * Extract instance name from Azure endpoint URL
 * e.g., "https://my-resource.openai.azure.com" -> "my-resource"
 */
const extractInstanceName = (endpoint: string): string => {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname;
    // Extract the first part before .openai.azure.com. The trailing `$`
    // anchor is required (CodeQL js/regex/missing-regexp-anchor): without
    // it `evil.openai.azure.com.attacker.tld` would match.
    const match = hostname.match(/^([^.]+)\.openai\.azure\.com$/);
    if (match) {
      return match[1];
    }
    // Fallback: just use the first part of hostname
    return hostname.split('.')[0];
  } catch {
    return endpoint;
  }
};

/**
 * Create a Graph RAG agent
 */
export const createGraphRAGAgent = (
  config: ProviderConfig,
  backend: GraphRAGBackend,
  codebaseContext?: CodebaseContext,
) => {
  const model = createChatModel(config);
  const tools = createGraphRAGTools(backend);

  // Use dynamic prompt if context is provided, otherwise use base prompt
  const systemPrompt = codebaseContext
    ? buildDynamicSystemPrompt(BASE_SYSTEM_PROMPT, codebaseContext)
    : BASE_SYSTEM_PROMPT;

  // Log the full prompt for debugging
  if (import.meta.env.DEV) {
    console.log('🤖 AGENT SYSTEM PROMPT:\n', systemPrompt);
  }

  const agent = createReactAgent({
    llm: model as any,
    tools: tools as any,
    messageModifier: new SystemMessage(systemPrompt) as any,
  });

  return agent;
};

/**
 * Message type for agent conversation
 */
export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  reasoning_content?: string;
}

/**
 * Stream a response from the agent
 * Uses BOTH streamModes for best of both worlds:
 * - 'values' for state transitions (tool calls, results) in proper order
 * - 'messages' for token-by-token text streaming
 *
 * This preserves the natural progression: reasoning → tool → reasoning → tool → answer
 */
export async function* streamAgentResponse(
  agent: ReturnType<typeof createReactAgent>,
  messages: AgentMessage[],
): AsyncGenerator<AgentStreamChunk> {
  try {
    // Build proper LangChain messages so additional_kwargs (including
    // reasoning_content) are preserved for the outbound converter patch.
    const formattedMessages = messages.map((m) => {
      if (m.role === 'user') {
        return new HumanMessage(m.content);
      }
      return new AIMessage({
        content: m.content,
        ...(m.reasoning_content
          ? { additional_kwargs: { reasoning_content: m.reasoning_content } }
          : {}),
      });
    });

    // Use BOTH modes: 'values' for structure, 'messages' for token streaming
    const stream = await agent.stream({ messages: formattedMessages }, {
      streamMode: ['values', 'messages'] as any,
      // Allow longer tool/reasoning loops (more Cursor-like persistence)
      recursionLimit: 50,
    } as any);

    // Track what we've yielded to avoid duplicates
    const yieldedToolCalls = new Set<string>();
    const yieldedToolResults = new Set<string>();
    let lastProcessedMsgCount = formattedMessages.length;
    // Track pending tool calls (for distinguishing reasoning vs final content)
    let pendingToolCalls = 0;
    // Track if we've seen any tool calls in this response turn.
    // Anything before the first tool call should be treated as "reasoning/narration"
    // so the UI can show the Cursor-like loop: plan → tool → update → tool → answer.
    let hasSeenToolCallThisTurn = false;
    // Track the last set of messages for reasoning_content extraction
    let lastStepMessages: any[] | null = null;

    for await (const event of stream) {
      // Events come as [streamMode, data] tuples when using multiple modes
      // or just data when using single mode
      let mode: string;
      let data: any;

      if (Array.isArray(event) && event.length === 2 && typeof event[0] === 'string') {
        [mode, data] = event;
      } else if (Array.isArray(event) && event[0]?._getType) {
        // Single messages mode format: [message, metadata]
        mode = 'messages';
        data = event;
      } else {
        // Assume values mode
        mode = 'values';
        data = event;
      }

      // DEBUG: Enhanced logging
      if (import.meta.env.DEV) {
        const msgType = (mode === 'messages' && data?.[0]?._getType?.()) || 'n/a';
        const hasContent = mode === 'messages' && data?.[0]?.content;
        const hasToolCalls = mode === 'messages' && data?.[0]?.tool_calls?.length > 0;
        console.log(`🔄 [${mode}] type:${msgType} content:${!!hasContent} tools:${hasToolCalls}`);
      }
      // Handle 'messages' mode - token-by-token streaming
      if (mode === 'messages') {
        const [msg] = Array.isArray(data) ? data : [data];
        if (!msg) continue;

        const msgType = msg._getType?.() || msg.type || msg.constructor?.name || 'unknown';

        // AIMessageChunk - streaming text tokens
        if (msgType === 'ai' || msgType === 'AIMessage' || msgType === 'AIMessageChunk') {
          const rawContent = msg.content;
          const toolCalls = msg.tool_calls || [];

          // Handle content that can be string or array of content blocks
          let content: string = '';
          if (typeof rawContent === 'string') {
            content = rawContent;
          } else if (Array.isArray(rawContent)) {
            // Content blocks format: [{type: 'text', text: '...'}, ...]
            content = rawContent
              .filter((block: any) => block.type === 'text' || typeof block === 'string')
              .map((block: any) => (typeof block === 'string' ? block : block.text || ''))
              .join('');
          }

          // If chunk has content, stream it
          if (content && content.length > 0) {
            // Determine if this is reasoning/narration vs final answer content.
            // - Before the first tool call: treat as reasoning (narration)
            // - Between tool calls/results: treat as reasoning
            // - After all tools are done: treat as final content
            const isReasoning =
              !hasSeenToolCallThisTurn || toolCalls.length > 0 || pendingToolCalls > 0;
            yield {
              type: isReasoning ? 'reasoning' : 'content',
              [isReasoning ? 'reasoning' : 'content']: content,
            };
          }

          // Track tool calls from message chunks
          if (toolCalls.length > 0) {
            hasSeenToolCallThisTurn = true;
            pendingToolCalls += toolCalls.length;
            for (const tc of toolCalls) {
              const toolId = tc.id || `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
              if (!yieldedToolCalls.has(toolId)) {
                yieldedToolCalls.add(toolId);
                let parsedArgs: Record<string, any>;
                try {
                  parsedArgs = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
                } catch {
                  parsedArgs = {};
                }
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: toolId,
                    name: tc.name || tc.function?.name || 'unknown',
                    args: tc.args || parsedArgs,
                    status: 'running',
                  },
                };
              }
            }
          }
        }

        // ToolMessage in messages mode
        if (msgType === 'tool' || msgType === 'ToolMessage') {
          const toolCallId = msg.tool_call_id || '';
          if (toolCallId && !yieldedToolResults.has(toolCallId)) {
            yieldedToolResults.add(toolCallId);
            const result =
              typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            yield {
              type: 'tool_result',
              toolCall: {
                id: toolCallId,
                name: msg.name || 'tool',
                args: {},
                result: result,
                status: 'completed',
              },
            };
            // After tool result, decrement pending count
            pendingToolCalls = Math.max(0, pendingToolCalls - 1);
          }
        }
      }

      // Handle 'values' mode - state snapshots for structure
      if (mode === 'values' && data?.messages) {
        const stepMessages = data.messages || [];
        lastStepMessages = stepMessages;

        // Process new messages for tool calls/results we might have missed
        for (let i = lastProcessedMsgCount; i < stepMessages.length; i++) {
          const msg = stepMessages[i];
          const msgType = msg._getType?.() || msg.type || 'unknown';

          // Catch tool calls from values mode (backup)
          if ((msgType === 'ai' || msgType === 'AIMessage') && !yieldedToolCalls.size) {
            const toolCalls = msg.tool_calls || [];
            for (const tc of toolCalls) {
              const toolId = tc.id || `tool-${Date.now()}`;
              if (!yieldedToolCalls.has(toolId)) {
                pendingToolCalls++;
                yieldedToolCalls.add(toolId);
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: toolId,
                    name: tc.name || 'unknown',
                    args: tc.args || {},
                    status: 'running',
                  },
                };
              }
            }
          }

          // Catch tool results from values mode (backup)
          if (msgType === 'tool' || msgType === 'ToolMessage') {
            const toolCallId = msg.tool_call_id || '';
            if (toolCallId && !yieldedToolResults.has(toolCallId)) {
              yieldedToolResults.add(toolCallId);
              const result =
                typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
              yield {
                type: 'tool_result',
                toolCall: {
                  id: toolCallId,
                  name: msg.name || 'tool',
                  args: {},
                  result: result,
                  status: 'completed',
                },
              };
              pendingToolCalls = Math.max(0, pendingToolCalls - 1);
            }
          }
        }

        lastProcessedMsgCount = stepMessages.length;
      }
    }

    // DEBUG: Stream completed normally
    if (import.meta.env.DEV) {
      console.log('✅ Stream completed normally, yielding done');
    }

    // Extract reasoning_content from the last assistant message for
    // DeepSeek thinking-mode round-tripping on the next turn.
    let reasoningContent: string | undefined;
    if (lastStepMessages) {
      for (let i = lastStepMessages.length - 1; i >= 0; i--) {
        const msg = lastStepMessages[i];
        const ak = (msg as any).additional_kwargs;
        if (ak && typeof ak === 'object' && typeof ak.reasoning_content === 'string') {
          reasoningContent = ak.reasoning_content as string;
          console.warn('[deepseek] captured reasoning_content length:', reasoningContent.length);
          break;
        }
      }
    }

    yield { type: 'done', reasoningContent };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // DEBUG: Stream error
    if (import.meta.env.DEV) {
      console.error('❌ Stream error:', message, error);
    }
    yield {
      type: 'error',
      error: message,
    };
  }
}

/**
 * Get a non-streaming response from the agent
 * Simpler for cases where streaming isn't needed
 */
export const invokeAgent = async (
  agent: ReturnType<typeof createReactAgent>,
  messages: AgentMessage[],
): Promise<string> => {
  const formattedMessages = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const result = await agent.invoke({ messages: formattedMessages });

  // result.messages is the full conversation state
  const lastMessage = result.messages[result.messages.length - 1];
  return lastMessage?.content?.toString() ?? 'No response generated.';
};
