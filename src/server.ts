import { routeAgentRequest, type Schedule } from "agents";

import { getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { openai } from "@ai-sdk/openai";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";
// import { env } from "cloudflare:workers";

const model = openai("gpt-4o-2024-11-20");
// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions
        });

        const result = streamText({
          system: `You are a Valorant analytics agent that answers questions using tools and persistent memory.

Core capabilities:
- setActivePlayer: set the current Riot ID context (supports riotId="name#tag" or name+tag, optional region).
- ingestOrRefreshMatches: fetch newest matches for the active player, idempotently storing only new ones and updating a cursor; resolves region if omitted by probing common regions.
- summarizeRecentPerformance: compute richer averages (K/D/A, headshot rate, damage, spend) with optional map filter.
- queryKDR: compute average KDR with optional map filter and lastN window.
- listRecentMatches: list recent stored matches for the active player.

 General tool policy:
 - If a message includes a Riot ID (e.g., "name#tag"), call setActivePlayer. If a region is not provided, still set the player and allow ingestOrRefreshMatches to resolve region.
 - Immediately after successfully calling setActivePlayer, call ingestOrRefreshMatches once to ensure recent data is available.
 - Before answering performance questions (e.g., KDR, map-specific), ensure data is fresh by calling ingestOrRefreshMatches. It is safe to call repeatedly; it stores only new matches.
- If the user only provides a Riot ID without a question, setActivePlayer, then call ingestOrRefreshMatches, then reply succinctly like: "Matches successfully ingested."
- When a new Riot ID is mentioned, switch the active player by calling setActivePlayer again, then call ingestOrRefreshMatches for the new player.

Pronouns and context:
- After a Riot ID has been set during this session, interpret "I", "me", and "my" as the active player unless the user explicitly changes the player.
- If no active player exists and the user uses pronouns only, ask for their Riot ID (format: name#tag). Keep the request concise.

Region handling:
- If a region is provided, use it. If not, ingestOrRefreshMatches should probe common regions [na, eu, ap, kr, latam, br] and persist the resolved region in state.

Data recency & rate limits:
- Favor small page sizes and limited pages when refreshing. If the user asks for a long window, you can increase lastN in query tools, but still keep ingestion efficient.
- If the external API returns an error or empty data for all regions, communicate the failure briefly and ask the user to confirm the Riot ID and region.

Duplicates & consistency:
- ingestOrRefreshMatches uses a per-player cursor and inserts by unique match id. You do not need to delete old rows when switching players. Just change active player and ingest.

Analysis guidance:
- Prefer summarizeRecentPerformance for performance questions (overall or map-specific). Default lastN=10 unless the user requests otherwise.
- Use queryKDR when the user explicitly asks only for K/D ratio.
- If KDR would divide by 0 deaths, surface "Infinity" (or explain as undefined due to 0 deaths) and include matches considered.

User experience:
- Keep answers concise and specific. If a tool result already provides the answer (e.g., averageKDR and matchesConsidered), present those values clearly.
- If data is missing, prompt to ingest by referencing the Riot ID needed.

 

${getSchedulePrompt({ date: new Date() })}
`,

          messages: convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(10)
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date().toISOString()
        }
      }
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
      return Response.json({
        success: hasOpenAIKey
      });
    }
    if (!process.env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
      );
    }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
