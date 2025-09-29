# AI Valorant Agent

AI Valorant analytics agent built on Cloudflare Agents. It ingests recent competitive matches via HenrikDev’s API, stores per-player stats, and answers questions (KDR, map performance, spend, headshot rate, etc.) using tools and persistent state.

Deployed: https://cf-val-chatbot.anandv0854.workers.dev/

## Features

- Per-user Agent instance and persisted chat history
- Current player memory using a per-player cursor
- Tools for:
  - Set active Riot ID (name#tag, optional region)
  - Ingest/refresh latest competitive matches (size=10, mode=competitive)
  - Compute average KDR with optional map filter
  - Summarize recent performance (K/D/A, headshot rate, damage, economy)
  - List recent stored matches

## Local Demo

### Prerequisites

- Cloudflare account and Wrangler
- One of:
  - OpenAI API key (default path)
  - OR Workers AI (no OpenAI key required)
- Discord account (for HenrikDev API key)
- HenrikDev API key:
  - Join this server: https://discord.gg/X3GaVkX2YN
  - Complete the initial server verification process
  - Navigate to the "# get a key" channel, click the "Generate" button, and
    follow the instructions to get a key

### 1) Install

```bash
npm install
```

### 2) Configure environment

Create `.dev.vars` in the repo root:

```env
# For OpenAI path (default)
OPENAI_API_KEY=sk-...

# HenrikDev API
HENRIK_API_KEY=your_henrik_api_key
```

Upload secrets for production when ready:

```bash
wrangler secret bulk .dev.vars
```

### 3) Run locally

```bash
npm start
```

Open http://localhost:5173 and:

- Enter your Riot ID as `name#tag` (if you don't have a Riot ID to use, you can try `curry#XDDDD` and `heartless#css`).
  The agent will set the player and ingest matches.
- Ask questions like “How is my performance on Ascent?” or “What’s my KDR?” or "What can I improve on?"

## Switching to Workers AI (no OpenAI key)

1. Ensure `workers-ai-provider` is installed (already in `package.json`).

2. Add an `ai` binding in `wrangler.jsonc`:

```jsonc
{
  // ...
  "ai": { "binding": "AI" }
}
```

3. Update `src/server.ts` to construct the Workers AI provider where `env` is available (inside the agent method):

```ts
// remove: import { openai } from "@ai-sdk/openai";
import { createWorkersAI } from "workers-ai-provider";

export class Chat extends AIChatAgent<Env> {
  async onChatMessage(onFinish, _options) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const model = workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast");

    // ... keep the rest of your streamText(...) call, but pass `model`
  }
}
```

4. If you fully switch to Workers AI, you can remove the OpenAI secret locally.

## Relevant File Guide

- `src/server.ts`: Agent entry. Routes requests, runs the model with tools, streams responses.
- `src/tools.ts`: Valorant tools: set player, ingest/refresh, queryKDR, summarize, list matches. Uses the Agent’s embedded SQLite and `this.setState`.
- `src/app.tsx`: React chat UI. Individual user sessions, tool UI, chat timestamps.

## Deploy

```bash
npm run deploy
```

Set production secrets via Wrangler before first deploy:

```bash
wrangler secret put HENRIK_API_KEY
# Only if using OpenAI
wrangler secret put OPENAI_API_KEY
```

## Credit (MIT license)

This project started from Cloudflare’s Agents Starter template and retains portions under the MIT license:

Copyright (c) Cloudflare, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
