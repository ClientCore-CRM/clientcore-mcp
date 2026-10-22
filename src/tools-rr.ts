import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { asText, type Api } from "./api.js";

/**
 * Описание входа движка rr-cdp - тот же текст, что у инструментов КП в MCP портала
 * (sales-portal, src/server/mcp/tools-kp.ts, INPUT_DESCRIPTION): агент в обоих
 * местах читает одно и то же.
 */
const INPUT_DESCRIPTION =
  "Вход движка rr-cdp: вкладки (tabs: { main, ... } - какие блоки считать), объём (users / views / sku по вкладке), " +
  "items - заголовки позиций, inputs - параметры модулей, paymentType - условия оплаты, media - медиа. " +
  "integration - интеграционный период, необязательно: { months: 1-3, discountPct: 5-100 кратно 5 }; " +
  "первые months месяцев подписка стоит на discountPct% меньше цены КП после скидок; " +
  "рекомендуемая длительность по цене в месяц: до 100 000 ₽ - 1, до 250 000 ₽ - 2, дороже - 3. " +
  "Точный состав и допустимые значения - в ответе kp_catalog.";

/** Скидка КП - одна схема на quote_kp и create_kp, как в MCP портала: расчёт со
 *  скидкой принимает ровно то, что примет создание. */
const DISCOUNT = z.object({
  type: z.enum(["percent", "fixed"]),
  value: z.number().min(0),
  untilDate: z.string().optional().describe("YYYY-MM-DD, необязательно"),
});

/** Срок договора - те же границы, что у портала (1-24 месяца). */
const TERM_MONTHS = z.number().int().min(1).max(24).nullable().optional();

/** Инструменты установки Retail Rocket (движок rr-cdp); сделка - в amoCRM. */
export function registerRrTools(server: McpServer, api: Api): void {
  server.tool(
    "kp_catalog",
    "Каталог движка цены этой установки (из чего собирается КП). Вызывать перед quote_kp и create_kp.",
    {},
    async () => {
      const r = await api("GET", "/api/v1/catalog");
      if (!r.ok) return asText({ error: true, status: r.status, details: r.data });
      return asText(r.data);
    }
  );

  server.tool(
    "quote_kp",
    "Посчитать КП без сохранения: услуги, итоги первого и следующих месяцев (прайсом, без скидки), НДС, " +
      "интеграционный период (integration) и год с ним (year). " +
      "discount и termMonths - те же, что пойдут в create_kp: со скидкой период и год считаются от цены после " +
      "скидки, как в КП; с termMonths приходит termTotal - итог за срок (период обрезан сроком). " +
      INPUT_DESCRIPTION,
    {
      engineInput: z.record(z.unknown()).describe(INPUT_DESCRIPTION),
      discount: DISCOUNT.optional(),
      termMonths: TERM_MONTHS.describe("Срок договора в месяцах, 1-24"),
    },
    async (args) => {
      const r = await api("POST", "/api/v1/kp/quote", args);
      if (!r.ok) return asText({ error: true, status: r.status, details: r.data });
      return asText(r.data);
    }
  );

  server.tool(
    "create_kp",
    "Создать КП по движку установки для СВОЕЙ сделки и получить публичную ссылку. Повторный вызов по той же сделке " +
      "перезаписывает твоё КП (replaced=true), КП коллеги не трогает - создаётся новое; forceNew=true создаёт ещё одно. " +
      "Скидка - только с причиной. " +
      "Сначала quote_kp, показать продавцу итог, потом create_kp. Открой url пользователю. " +
      INPUT_DESCRIPTION,
    {
      dealId: z.string().describe("Числовой id сделки в amoCRM"),
      clientName: z.string(),
      clientSite: z.string().optional().describe("Сайт клиента - по нему подтянется логотип"),
      clientLogo: z.string().optional().describe("Ссылка на логотип, если автоматический не подошёл"),
      engineInput: z.record(z.unknown()).describe(INPUT_DESCRIPTION),
      tasks: z.array(z.string()).max(8).optional().describe("Задачи клиента для КП"),
      discount: DISCOUNT.optional(),
      discountReason: z.string().optional().describe("Причина скидки, обязательна со скидкой"),
      termMonths: TERM_MONTHS.describe("Срок договора в месяцах"),
      forceNew: z.boolean().optional().describe("Создать новое КП, а не перезаписать существующее по сделке"),
    },
    async (args) => {
      const r = await api("POST", "/api/v1/kp", { engine: "rr-cdp", ...args });
      if (!r.ok) return asText({ error: true, status: r.status, details: r.data });
      return asText(r.data);
    }
  );
}
