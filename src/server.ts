import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asText, makeApi } from "./api.js";
import { baseUrlFor, toolsetFor, type Env } from "./config.js";
import { registerCcTools } from "./tools-cc.js";
import { registerCommonTools } from "./tools-common.js";
import { registerRrTools } from "./tools-rr.js";

export const SERVER_NAME = "calculator-mcp";
export const SERVER_VERSION = "0.4.0";

type CatalogProbe = { engine: string | null; error: string | null };

/** Спрашивает каталог и по полю engine понимает установку. Любой сбой превращается в понятный текст. */
async function probeCatalog(baseUrl: string, token: string): Promise<CatalogProbe> {
  try {
    const r = await makeApi(baseUrl, token)("GET", "/api/v1/catalog");
    const data = (r.data ?? {}) as { engine?: unknown; error?: unknown };
    if (!r.ok) {
      const msg = typeof data.error === "string" && data.error ? data.error : `HTTP ${r.status}`;
      return { engine: null, error: `Портал ${baseUrl} ответил ${r.status}: ${msg}` };
    }
    if (typeof data.engine !== "string") {
      return { engine: null, error: `Портал ${baseUrl} не вернул движок цены в каталоге` };
    }
    return { engine: data.engine, error: null };
  } catch (e) {
    return { engine: null, error: `нет связи с ${baseUrl}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Старт: каталог -> набор инструментов. Токен недействителен или портал
 * недоступен - сервер поднимается с одним calculator_status, который отвечает
 * текстом ошибки портала, а не пустым списком.
 */
export async function buildServer(token: string, env: Env): Promise<McpServer> {
  const baseUrl = baseUrlFor(token, env);
  const probe = await probeCatalog(baseUrl, token);
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
        const now = await probeCatalog(baseUrl, token);
        if (now.engine && toolsetFor(now.engine) !== "status") {
          return asText({ ok: true, message: "Портал снова отвечает. Перезапусти MCP-сервер, чтобы появились инструменты." });
        }
        const message = now.error ?? `Портал ${baseUrl} работает с движком «${now.engine}», его калькулятор-mcp не поддерживает.`;
        return asText({ ok: false, message });
      }
    );
    return server;
  }
  registerCommonTools(server, api);
  return server;
}
