/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod/v3";

import type { Chat } from "./server";
import { getCurrentAgent } from "agents";

// Regions supported by HenrikDev API for Riot IDs
const REGIONS = ["na", "eu", "ap", "kr", "latam", "br"] as const;

function splitRiotId(riotId: string): { name: string; tag: string } | null {
  const s = riotId.trim();
  const i = s.indexOf("#");
  if (i === -1) return null;
  return { name: s.slice(0, i), tag: s.slice(i + 1) };
}

/**
 * Set the active Valorant player for the conversation.
 * Accepts either riotId ("name#tag") with optional region, or explicit name/tag.
 */
const setActivePlayer = tool({
  description:
    "Set the active Valorant player. Accepts riotId='name#tag' (optional region) or explicit name+tag (optional region).",
  inputSchema: z.object({
    riotId: z.string().min(3).optional(),
    name: z.string().min(1).optional(),
    tag: z.string().min(1).optional(),
    region: z.enum(REGIONS as unknown as [string, ...string[]]).optional()
  }),
  execute: async (input) => {
    const { agent } = getCurrentAgent<Chat>();
    let region: string | undefined = input.region;
    let name: string | undefined = input.name;
    let tag: string | undefined = input.tag;

    if (input.riotId) {
      const parts = splitRiotId(input.riotId);
      if (!parts) return "Invalid riotId. Expected format name#tag.";
      ({ name, tag } = parts);
    }

    if (!name || !tag) {
      return "Please provide a riotId like name#tag, or both name and tag.";
    }

    const currentState = (agent!.state as Record<string, unknown>) || {};
    await agent!.setState({
      ...currentState,
      activePlayer: { region, name, tag }
    });
    return `Active player is now ${name}#${tag}${region ? ` (${region})` : ""}.`;
  }
});

/**
 * Fetch latest matches for the active player and store only new ones.
 * - Resolves region if missing by looking for common regions
 * - Maintains a per-player pointer to stop when reaching known matches
 * - Extracts player K/D/A for quick stats
 */
const ingestOrRefreshMatches = tool({
  description:
    "Fetch newest matches for active player and store only new ones; resolves region if missing and updates a cursor.",
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent<Chat>();
    const active = ((agent!.state as any) || {}).activePlayer as
      | { region?: string; name: string; tag: string }
      | undefined;
    if (!active?.name || !active?.tag) return "No active player set.";

    agent!.sql`
      CREATE TABLE IF NOT EXISTS valorant_matches (
        id TEXT PRIMARY KEY,
        region TEXT,
        name TEXT,
        tag TEXT,
        started_at TEXT,
        mode TEXT,
        map TEXT,
        player_kills INTEGER,
        player_deaths INTEGER,
        player_assists INTEGER,
        raw TEXT
      )
    `;
    agent!.sql`
      CREATE TABLE IF NOT EXISTS valorant_player_stats (
        match_id TEXT PRIMARY KEY,
        region TEXT,
        name TEXT,
        tag TEXT,
        character TEXT,
        rank TEXT,
        kills INTEGER,
        deaths INTEGER,
        assists INTEGER,
        bodyshots INTEGER,
        headshots INTEGER,
        legshots INTEGER,
        score INTEGER,
        spent_overall INTEGER,
        spent_avg REAL,
        loadout_overall INTEGER,
        loadout_avg REAL,
        damage_made INTEGER,
        damage_received INTEGER
      )
    `;
    agent!.sql`
      CREATE TABLE IF NOT EXISTS player_cursor (
        pk TEXT PRIMARY KEY,
        last_match_id TEXT,
        last_started_at TEXT
      )
    `;

    // Helper to fetch latest competitive matches (max size 10 per docs)
    async function fetchLatestCompetitive(region: string) {
      const params = new URLSearchParams({ size: "10", mode: "competitive" });
      const apiKey = (agent as any).env?.HENRIK_API_KEY as string | undefined;
      const a = active as { name: string; tag: string };
      const url = `https://api.henrikdev.xyz/valorant/v3/matches/${region}/${encodeURIComponent(
        a.name
      )}/${encodeURIComponent(a.tag)}?${params.toString()}`;
      const headers: HeadersInit = { Accept: "*/*" };
      if (apiKey) {
        (headers as Record<string, string>).Authorization = apiKey;
      }
      const res = await fetch(url, { headers });
      if (!res.ok)
        return { ok: false as const, status: res.status, data: [] as any[] };
      const json = (await res.json()) as any;
      const data = Array.isArray(json?.data) ? (json.data as any[]) : [];
      return { ok: true as const, status: 200, data };
    }

    // Resolve region if missing by looking for common regions
    let region = active.region as string | undefined;
    if (!region) {
      for (const r of REGIONS) {
        const r1 = await fetchLatestCompetitive(r);
        if (r1.ok && Array.isArray(r1.data) && r1.data.length > 0) {
          region = r;
          break;
        }
      }
      if (!region) return "Could not resolve region for this Riot ID.";
      const currentState = (agent!.state as Record<string, unknown>) || {};
      await agent!.setState({
        ...currentState,
        activePlayer: { ...active, region }
      });
    }

    const pk = `${region}:${active.name}:${active.tag}`;
    const cur = agent!.sql<{ last_match_id: string | null }>`
      SELECT last_match_id FROM player_cursor WHERE pk = ${pk}
    `;
    const lastKnownId = cur?.[0]?.last_match_id ?? null;

    let inserted = 0;
    let newestId: string | null = null;
    let newestStarted: string | null = null;

    const res = await fetchLatestCompetitive(region!);
    if (!res.ok) return `HenrikDev error: ${res.status}`;
    const matches = res.data;

    if (matches.length > 0) {
      const meta0 = matches[0]?.metadata ?? {};
      newestId = meta0?.matchid ?? matches[0]?.matchid ?? null;
      newestStarted =
        meta0?.game_start_patched ??
        (meta0?.game_start
          ? new Date(meta0.game_start * 1000).toISOString()
          : null);
    }

    for (const m of matches as any[]) {
      const meta = m?.metadata ?? {};
      const matchId = meta?.matchid ?? m?.matchid;
      if (!matchId) continue;

      if (lastKnownId && matchId === lastKnownId) {
        break;
      }

      const started =
        meta?.game_start_patched ??
        (meta?.game_start
          ? new Date(meta.game_start * 1000).toISOString()
          : null);
      const map = meta?.map ?? null;
      const mode = meta?.mode ?? null;

      const allPlayers = m?.players?.all_players ?? [];
      const p = allPlayers.find(
        (pp: any) =>
          pp?.name?.toLowerCase() === active.name.toLowerCase() &&
          pp?.tag?.toLowerCase() === active.tag.toLowerCase()
      );
      const kills = p?.stats?.kills ?? null;
      const deaths = p?.stats?.deaths ?? null;
      const assists = p?.stats?.assists ?? null;
      const character = p?.character ?? null;
      const rank = p?.currenttier_patched ?? null;
      const score = p?.stats?.score ?? null;
      const bodyshots = p?.stats?.bodyshots ?? null;
      const headshots = p?.stats?.headshots ?? null;
      const legshots = p?.stats?.legshots ?? null;
      const spent_overall = p?.economy?.spent?.overall ?? null;
      const spent_avg = p?.economy?.spent?.average ?? null;
      const loadout_overall = p?.economy?.loadout_value?.overall ?? null;
      const loadout_avg = p?.economy?.loadout_value?.average ?? null;
      const damage_made = p?.damage_made ?? null;
      const damage_received = p?.damage_received ?? null;

      const exists = agent!.sql<{ c: number }>`
        SELECT COUNT(1) AS c FROM valorant_matches WHERE id = ${matchId}
      `;
      if (!exists || exists[0]?.c === 0) {
        agent!.sql`
          INSERT OR IGNORE INTO valorant_matches (
            id, region, name, tag, started_at, mode, map, player_kills, player_deaths, player_assists, raw
          ) VALUES (
            ${matchId}, ${region}, ${active.name}, ${active.tag}, ${started}, ${mode}, ${map}, ${kills}, ${deaths}, ${assists}, ${null}
          )
        `;
        inserted++;
      }

      // Upsert per-match player stats for better summaries
      agent!.sql`
        INSERT OR REPLACE INTO valorant_player_stats (
          match_id, region, name, tag, character, rank, kills, deaths, assists,
          bodyshots, headshots, legshots, score,
          spent_overall, spent_avg, loadout_overall, loadout_avg,
          damage_made, damage_received
        ) VALUES (
          ${matchId}, ${region}, ${active.name}, ${active.tag}, ${character}, ${rank}, ${kills}, ${deaths}, ${assists},
          ${bodyshots}, ${headshots}, ${legshots}, ${score},
          ${spent_overall}, ${spent_avg}, ${loadout_overall}, ${loadout_avg},
          ${damage_made}, ${damage_received}
        )
      `;
    }

    if (newestId) {
      agent!.sql`
        INSERT INTO player_cursor (pk, last_match_id, last_started_at)
        VALUES (${pk}, ${newestId}, ${newestStarted})
        ON CONFLICT(pk) DO UPDATE SET
          last_match_id = excluded.last_match_id,
          last_started_at = excluded.last_started_at
      `;
    }

    return `Refreshed ${active.name}#${active.tag} (${region}). New matches stored: ${inserted}.`;
  }
});

/**
 * Compute average KDR for the active player, optionally filtered by map and last N matches.
 */
const queryKDR = tool({
  description:
    "Compute average KDR for the active player; supports optional map filter and lastN limit.",
  inputSchema: z.object({
    map: z.string().optional(),
    lastN: z.number().min(1).max(100).default(20)
  }),
  execute: async ({ map, lastN = 20 }) => {
    const { agent } = getCurrentAgent<Chat>();
    const active = ((agent!.state as any) || {}).activePlayer as
      | { region?: string; name: string; tag: string }
      | undefined;
    if (!active?.name || !active?.tag) return "No active player set.";

    let rows: Array<{ k: number | null; d: number | null }>;
    if (map) {
      rows = agent!.sql<{ k: number | null; d: number | null }>`
        SELECT player_kills as k, player_deaths as d
        FROM valorant_matches
        WHERE name = ${active.name} AND tag = ${active.tag} AND map = ${map}
        ORDER BY COALESCE(started_at, '') DESC
        LIMIT ${lastN}
      `;
    } else {
      rows = agent!.sql<{ k: number | null; d: number | null }>`
        SELECT player_kills as k, player_deaths as d
        FROM valorant_matches
        WHERE name = ${active.name} AND tag = ${active.tag}
        ORDER BY COALESCE(started_at, '') DESC
        LIMIT ${lastN}
      `;
    }

    if (!rows?.length) return "No stored matches yet. Try ingesting first.";

    const ks = rows.map((r) => (typeof r.k === "number" ? r.k : 0));
    const ds = rows.map((r) => (typeof r.d === "number" ? r.d : 0));
    const sumK = ks.reduce((a, b) => a + b, 0);
    const sumD = ds.reduce((a, b) => a + b, 0);
    const kdr =
      sumD === 0 ? (sumK > 0 ? Number.POSITIVE_INFINITY : 0) : sumK / sumD;

    return {
      matchesConsidered: rows.length,
      map: map ?? "all",
      averageKDR: Number.isFinite(kdr) ? Number(kdr.toFixed(2)) : "Infinity"
    };
  }
});

/**
 * Summarize recent performance using retrieved per-match stats.
 */
const summarizeRecentPerformance = tool({
  description:
    "Summarize recent performance (averages) for the active player. Optional map filter and lastN window.",
  inputSchema: z.object({
    map: z.string().optional(),
    lastN: z.number().min(1).max(100).default(10)
  }),
  execute: async ({ map, lastN = 10 }) => {
    const { agent } = getCurrentAgent<Chat>();
    const active = ((agent!.state as any) || {}).activePlayer as
      | { region?: string; name: string; tag: string }
      | undefined;
    if (!active?.name || !active?.tag) return "No active player set.";

    // Join player stats with matches to allow map filtering and ordering by started_at
    let rows: Array<{
      kills: number | null;
      deaths: number | null;
      assists: number | null;
      headshots: number | null;
      bodyshots: number | null;
      legshots: number | null;
      score: number | null;
      spent_overall: number | null;
      spent_avg: number | null;
      loadout_overall: number | null;
      loadout_avg: number | null;
      damage_made: number | null;
      damage_received: number | null;
    }>;

    if (map) {
      rows = agent!.sql`
        SELECT ps.kills, ps.deaths, ps.assists, ps.headshots, ps.bodyshots, ps.legshots,
               ps.score, ps.spent_overall, ps.spent_avg, ps.loadout_overall, ps.loadout_avg,
               ps.damage_made, ps.damage_received
        FROM valorant_player_stats ps
        JOIN valorant_matches m ON m.id = ps.match_id
        WHERE ps.name = ${active.name} AND ps.tag = ${active.tag} AND m.map = ${map}
        ORDER BY COALESCE(m.started_at, '') DESC
        LIMIT ${lastN}
      ` as unknown as typeof rows;
    } else {
      rows = agent!.sql`
        SELECT ps.kills, ps.deaths, ps.assists, ps.headshots, ps.bodyshots, ps.legshots,
               ps.score, ps.spent_overall, ps.spent_avg, ps.loadout_overall, ps.loadout_avg,
               ps.damage_made, ps.damage_received
        FROM valorant_player_stats ps
        JOIN valorant_matches m ON m.id = ps.match_id
        WHERE ps.name = ${active.name} AND ps.tag = ${active.tag}
        ORDER BY COALESCE(m.started_at, '') DESC
        LIMIT ${lastN}
      ` as unknown as typeof rows;
    }

    if (!rows?.length) return "No stored matches yet. Try ingesting first.";

    const sum = (arr: Array<number | null>) =>
      arr.reduce((a: number, b: number | null) => a + (b ?? 0), 0);
    const n = rows.length;

    const kills = sum(rows.map((r) => r.kills));
    const deaths = sum(rows.map((r) => r.deaths));
    const assists = sum(rows.map((r) => r.assists));
    const headshots = sum(rows.map((r) => r.headshots));
    const bodyshots = sum(rows.map((r) => r.bodyshots));
    const legshots = sum(rows.map((r) => r.legshots));
    const score = sum(rows.map((r) => r.score));
    const damage_made = sum(rows.map((r) => r.damage_made));
    const damage_received = sum(rows.map((r) => r.damage_received));

    const avg = (x: number) => Number((n > 0 ? x / n : 0).toFixed(2));
    const shotsTotal = headshots + bodyshots + legshots;
    const hsRate =
      shotsTotal > 0 ? Number(((headshots / shotsTotal) * 100).toFixed(2)) : 0;

    const avgSpentOverall = avg(sum(rows.map((r) => r.spent_overall)));
    const avgSpent = Number(
      (n > 0 ? sum(rows.map((r) => r.spent_avg)) / n : 0).toFixed(2)
    );
    const avgLoadoutOverall = avg(sum(rows.map((r) => r.loadout_overall)));
    const avgLoadout = Number(
      (n > 0 ? sum(rows.map((r) => r.loadout_avg)) / n : 0).toFixed(2)
    );

    const kdr =
      deaths === 0
        ? kills > 0
          ? "Infinity"
          : 0
        : Number((kills / deaths).toFixed(2));

    return {
      matchesConsidered: n,
      map: map ?? "all",
      averages: {
        kills: avg(kills),
        deaths: avg(deaths),
        assists: avg(assists),
        kdr,
        score: avg(score),
        damageMade: avg(damage_made),
        damageReceived: avg(damage_received),
        headshotRatePct: hsRate,
        spentOverall: avgSpentOverall,
        spentAvgPerRound: avgSpent,
        loadoutOverall: avgLoadoutOverall,
        loadoutAvgPerRound: avgLoadout
      }
    };
  }
});

/**
 * List recent stored matches for the active player.
 */
const listRecentMatches = tool({
  description: "List recent stored matches for the active player.",
  inputSchema: z.object({ limit: z.number().min(1).max(50).default(10) }),
  execute: async ({ limit = 10 }) => {
    const { agent } = getCurrentAgent<Chat>();
    const active = ((agent!.state as any) || {}).activePlayer as
      | { region?: string; name: string; tag: string }
      | undefined;
    if (!active?.name || !active?.tag) return "No active player set.";

    const rows = agent!.sql<{
      id: string;
      started_at: string | null;
      mode: string | null;
      map: string | null;
    }>`
      SELECT id, started_at, mode, map
      FROM valorant_matches
      WHERE name = ${active.name} AND tag = ${active.tag}
      ORDER BY COALESCE(started_at, '') DESC
      LIMIT ${limit}
    `;

    if (!rows?.length) return "No stored matches. Ingest first.";
    return rows
      .map(
        (r, i) =>
          `${i + 1}. ${r.started_at ?? "unknown"} • ${r.mode ?? "mode"} • ${r.map ?? "map"} • id=${r.id}`
      )
      .join("\n");
  }
});

/**
 * Export all available tools
 * These will be provided to the AI model to describe available capabilities
 */
export const tools = {
  setActivePlayer,
  ingestOrRefreshMatches,
  queryKDR,
  summarizeRecentPerformance,
  listRecentMatches
} satisfies ToolSet;

/**
 * Implementation of confirmation-required tools
 * This object contains the actual logic for tools that need human approval
 * Each function here corresponds to a tool above that doesn't have an execute function
 */
export const executions = {};
