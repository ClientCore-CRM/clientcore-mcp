import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asText, type Api } from "./api.js";

/** Инструменты обеих установок: логотип и ссылка для клиента. */
export function registerCommonTools(server: McpServer, api: Api): void {
  /* ───────── set_kp_logo ───────── */
  server.tool(
    "set_kp_logo",
    "Сменить логотип у существующего КП по его slug (часть ссылки после /kp/). " +
      "logoUrl — прямая ссылка на картинку (png/jpg/svg). Передай пустую строку или null, чтобы убрать логотип.",
    {
      slug: z.string().describe("slug КП — часть ссылки после /kp/ (например tripster-ab12cd)"),
      logoUrl: z
        .string()
        .nullable()
        .describe("URL логотипа (png/jpg/svg) или null/пусто чтобы убрать"),
    },
    async (args) => {
      const r = await api("POST", "/api/v1/kp/logo", args);
      if (!r.ok) return asText({ error: true, status: r.status, details: r.data });
      return asText(r.data);
    }
  );

  /* ───────── create_share_link ───────── */
  server.tool(
    "create_share_link",
    "Создать ссылку для отправки клиенту по slug КП. Ссылка с токеном — открытия " +
      "клиентом логируются и атрибутируются (видно в портале). Возвращает shareUrl (для клиента) и publicUrl.",
    {
      slug: z.string().describe("slug КП — часть ссылки после /kp/"),
    },
    async (args) => {
      const r = await api("POST", "/api/v1/kp/share", args);
      if (!r.ok) return asText({ error: true, status: r.status, details: r.data });
      return asText(r.data);
    }
  );
}
