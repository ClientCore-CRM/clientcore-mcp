#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.CLIENTCORE_BASE_URL ?? "https://offer.clientcore.ru").replace(/\/$/, "");
const TOKEN = process.env.CLIENTCORE_API_TOKEN ?? "";

if (!TOKEN) {
  // eslint-disable-next-line no-console
  console.error(
    "clientcore-mcp: не задан CLIENTCORE_API_TOKEN. Получи токен в offer.clientcore.ru → Настройки и добавь его в конфиг MCP-клиента."
  );
  process.exit(1);
}

async function api(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = { error: `HTTP ${res.status}` };
  }
  return { ok: res.ok, status: res.status, data };
}

function asText(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

const server = new McpServer({
  name: "clientcore-mcp",
  version: "0.1.0",
});

/* ───────── get_catalog ───────── */
server.tool(
  "get_catalog",
  "Получить каталог ClientCore: доступные пакеты (lite/starter/growth_plus), их состав и цены, список услуг с ключами для кастомных КП, разовые услуги (addons), типы оплаты. Вызови это ПЕРЕД созданием кастомного КП, чтобы знать правильные selectionKey.",
  {},
  async () => {
    const r = await api("GET", "/api/v1/catalog");
    if (!r.ok) return asText({ error: true, status: r.status, details: r.data });
    return asText(r.data);
  }
);

/* ───────── create_package_kp ───────── */
server.tool(
  "create_package_kp",
  "Создать КП на основе пакета (CRM Лайт 100к / CRM Старт 150к / CRM Рост 200к). " +
    "Для KPI-режима (Performance) передай kpiMode=true — лимиты пакета удваиваются, " +
    "плюс премия 15% от прироста выручки CRM (мин 80к/мес). Возвращает публичную ссылку на КП и ссылку на PDF.",
  {
    clientName: z.string().describe("Название клиента/компании"),
    clientSite: z.string().optional().describe("Сайт клиента (для логотипа и slug)"),
    clientLogo: z.string().optional().describe("URL логотипа (опционально)"),
    packageKey: z
      .enum(["lite", "starter", "growth_plus"])
      .describe("lite=Лайт 100к, starter=Старт 150к, growth_plus=Рост 200к"),
    kpiMode: z.boolean().optional().describe("Performance KPI: лимиты ×2 + премия за прирост"),
    contract12Months: z
      .boolean()
      .optional()
      .describe("Контракт 12 мес: ТЗ Mindbox бесплатно, мастер-шаблон до 90к включено"),
    paymentType: z
      .enum(["prepay", "postpay0", "postpay7", "postpay14", "postpay30"])
      .optional()
      .describe("Тип оплаты (наценка за постоплату)"),
    revenueTier: z
      .enum(["up_to_1m", "above_1m"])
      .optional()
      .describe("Размер базы клиента (влияет на цену аудита/стратегии)"),
    addOns: z
      .record(z.object({ qty: z.number().int().positive().optional() }))
      .optional()
      .describe(
        "Разовые услуги. Ключи: strategy_audit, strategy_automation_strategy, strategy_loyalty_model, strategy_mindbox_setup, design_universal_template (qty = блоки шаблона)"
      ),
    tasks: z.array(z.string()).max(8).optional().describe("Задачи клиента (буллеты)"),
    vertical: z.string().optional().describe("Сегмент: fashion/ecom/horeca/retail/beauty/b2b/saas/general"),
    kpiBaseline: z
      .object({
        withKpi: z.boolean(),
        prevYearMonthly: z.array(z.number()).length(12).describe("Выручка CRM прошлого года, 12 мес, млн ₽"),
        recent3Monthly: z.array(z.number()).length(3).describe("3 последних месяца, млн ₽"),
        recent3MonthIndices: z.array(z.number()).length(3).describe("Индексы месяцев 0-11"),
        baseRate: z.number().describe("Базовая ставка, тыс ₽/мес"),
        contractMonths: z.number().describe("Срок контракта, мес"),
      })
      .optional()
      .describe("Расчёт KPI с данными клиента (только при kpiMode=true)"),
  },
  async (args) => {
    const r = await api("POST", "/api/v1/kp/package", args);
    if (!r.ok) return asText({ error: true, status: r.status, details: r.data });
    return asText(r.data);
  }
);

/* ───────── create_custom_kp ───────── */
server.tool(
  "create_custom_kp",
  "Создать кастомное КП по произвольному набору услуг (selections). Сначала вызови get_catalog, " +
    "чтобы получить правильные selectionKey. Возвращает публичную ссылку и PDF.",
  {
    clientName: z.string().describe("Название клиента"),
    clientSite: z.string().optional(),
    clientLogo: z.string().optional(),
    selections: z
      .record(
        z.object({
          status: z.enum(["included", "excluded", "on_request"]),
          hours: z.number().optional(),
          qty: z.number().optional(),
        })
      )
      .describe("Карта услуг: { selectionKey: { status, hours?, qty? } }. Ключи из get_catalog."),
    revenueTier: z.enum(["up_to_1m", "above_1m"]).optional(),
    mode: z.enum(["hours", "mechanics"]).optional().describe("Режим расчёта автоматизаций"),
    projectType: z.enum(["regular", "oneoff"]).optional().describe("regular=ежемесячно, oneoff=разовый проект"),
    paymentType: z.enum(["prepay", "postpay0", "postpay7", "postpay14", "postpay30"]).optional(),
    contract12Months: z.boolean().optional(),
  },
  async (args) => {
    const r = await api("POST", "/api/v1/kp/custom", args);
    if (!r.ok) return asText({ error: true, status: r.status, details: r.data });
    return asText(r.data);
  }
);

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

const transport = new StdioServerTransport();
await server.connect(transport);
// eslint-disable-next-line no-console
console.error(`clientcore-mcp подключён · ${BASE_URL}`);
