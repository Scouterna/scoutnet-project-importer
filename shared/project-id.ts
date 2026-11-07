import type { ScoutnetEnv } from "./env.ts";
import { hostEnvs, siteOrigins } from "./env.ts";

export type ParsedProject =
  | { ok: true; id: string; env: ScoutnetEnv }
  | { ok: false; reason: "no_id" | "unknown_host" };

const extractId = (text: string): string | null => {
  if (/^\d+$/.test(text)) return text;
  return /\/activities\/view\/(\d+)/.exec(text)?.[1] ?? null;
};

const extractHost = (text: string): string | null => {
  const authority = /^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/?#]+)/i.exec(text)?.[1];
  if (!authority) return null;
  return authority.replace(/^.*@/, "").replace(/:\d*$/, "").toLowerCase();
};

export const parseProject = (input: string): ParsedProject => {
  const text = input.trim();
  const id = extractId(text);
  if (!id) return { ok: false, reason: "no_id" };
  const host = /^\d+$/.test(text) ? null : extractHost(text);
  if (host === null) return { ok: true, id, env: "production" };
  const env = hostEnvs.get(host);
  return env ? { ok: true, id, env } : { ok: false, reason: "unknown_host" };
};

export const apiPageUrl = (env: ScoutnetEnv, id: string): string =>
  `${siteOrigins[env]}/activities/view/${id}#project_tabmenu_tab_api_pane`;
