import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asText, makeApi } from "./api.js";
import { CC_URL, baseUrlFor, toolsetFor, type Env } from "./config.js";
import { registerCcTools } from "./tools-cc.js";
import { registerCommonTools } from "./tools-common.js";
import { registerRrTools } from "./tools-rr.js";

/** Таймаут стартового опроса каталога: зависший портал не должен держать initialize дольше таймаута клиента (~30 с). */
export const PROBE_TIMEOUT_MS = 10_000;

export const SERVER_NAME = "calculator-mcp";
export const SERVER_VERSION = "0.4.0";

type CatalogProbe = { engine: string | null; error: string | null; status: number | null };

/**
 * Подсказка к 401 для ключа ClientCore на адресе ClientCore по умолчанию. До
 * префикса по установке портал Retail Rocket тоже выдавал ключи с cck_, и такой
 * ключ уходит на offer.clientcore.ru, где его нет: продавец РР видел только
 * «токен недействителен» и не понимал, что дело в адресе.
 */
export function oldRrKeyHint(token: string, baseUrl: string, status: number | null): string | null {
  if (status !== 401 || !token.startsWith("cck_") || baseUrl !== CC_URL) return null;
  return "если это ключ портала Retail Rocket — перевыпусти его (новые начинаются с rrk_) или задай CALCULATOR_BASE_URL=https://rrsales.clientcore.ru";
}

/** Спрашивает каталог и по полю engine понимает установку. Любой сбой превращается в понятный текст. */
async function probeCatalog(baseUrl: string, token: string, timeoutMs: number): Promise<CatalogProbe> {
  try {
    const r = await makeApi(baseUrl, token, timeoutMs)("GET", "/api/v1/catalog");
    const data = (r.data ?? {}) as { engine?: unknown; error?: unknown };
    if (!r.ok) {
      const msg = typeof data.error === "string" && data.error ? data.error : `HTTP ${r.status}`;
      return { engine: null, error: `Портал ${baseUrl} ответил ${r.status}: ${msg}`, status: r.status };
    }
    if (typeof data.engine !== "string") {
      return { engine: null, error: `Портал ${baseUrl} не вернул движок цены в каталоге`, status: r.status };
    }
    return { engine: data.engine, error: null, status: r.status };
  } catch (e) {
    return { engine: null, error: `нет связи с ${baseUrl}: ${e instanceof Error ? e.message : String(e)}`, status: null };
  }
}

/**
 * Старт: каталог -> набор инструментов. Токен недействителен или портал
 * недоступен - сервер поднимается с одним calculator_status, который отвечает
 * текстом ошибки портала, а не пустым списком.
 */
export async function buildServer(
  token: string,
  env: Env,
  probeTimeoutMs: number = PROBE_TIMEOUT_MS
): Promise<McpServer> {
  const baseUrl = baseUrlFor(token, env);
  const probe = await probeCatalog(baseUrl, token, probeTimeoutMs);
  const toolset = toolsetFor(probe.engine);
  const label = toolset === "rr" ? "Retail Rocket" : toolset === "cc" ? "ClientCore" : null;

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: label
        ? `Калькулятор КП ${label}. Подключён портал ${baseUrl}; все КП создаются только в этой установке.`
        : `Калькулятор КП не подключён к порталу ${baseUrl}. Вызови calculator_status: он покажет причину.`,
    }
  );

  const api = makeApi(baseUrl, token);
  if (toolset === "cc") registerCcTools(server, api);
  else if (toolset === "rr") registerRrTools(server, api);
  else {
    server.tool(
      "calculator_status",
      "Состояние подключения к порталу КП: почему нет инструментов калькулятора (ключ отозван, нет связи, неизвестная установка).",
      {},
      async () => {
        const now = await probeCatalog(baseUrl, token, probeTimeoutMs);
        if (now.engine && toolsetFor(now.engine) !== "status") {
          return asText({ ok: true, message: "Портал снова отвечает. Перезапусти MCP-сервер, чтобы появились инструменты." });
        }
        const message = now.error ?? `Портал ${baseUrl} работает с движком «${now.engine}», его calculator-mcp не поддерживает.`;
        const hint = oldRrKeyHint(token, baseUrl, now.status);
        return asText(hint ? { ok: false, message, hint } : { ok: false, message });
      }
    );
    return server;
  }
  registerCommonTools(server, api);
  return server;
}
