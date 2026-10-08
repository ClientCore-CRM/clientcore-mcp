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

/**
 * Потолок месячной CRM-выручки в млн ₽ — выше значит «не те единицы».
 * Та же граница, что на сервере (calc-clientcore src/lib/kpi.ts,
 * MAX_MONTHLY_REVENUE_M): сервер — главный замок, здесь ранняя проверка, чтобы
 * агент увидел ошибку в ответе тула и сразу переслал правильные числа.
 * Боевой случай 28.09.2026, Пироги №1: выручку передали в рублях, и клиенту
 * ушло КП с «Прирост за контракт 1873813.9М».
 */
const MAX_MONTHLY_REVENUE_M = 1000;

function kpiUnitsError(k: { history: { value: number }[] }): string | null {
  const bad = k.history.map((h) => h.value).find((v) => v > MAX_MONTHLY_REVENUE_M);
  if (bad === undefined) return null;
  const inM = bad >= 100_000 ? bad / 1_000_000 : bad / 1000;
  return (
    `Выручка KPI указывается в млн ₽ в месяц, а получено ${bad}. ` +
    `Похоже на ${bad >= 100_000 ? "рубли" : "тысячи рублей"}: это ${+inM.toFixed(2)} млн ₽. Пересчитай всю историю и вызови снова.`
  );
}

function asText(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

const server = new McpServer({
  name: "clientcore-mcp",
  version: "0.2.0",
});

/* ───────── get_catalog ───────── */
server.tool(
  "get_catalog",
  "Получить каталог ClientCore: доступные пакеты (lite/starter/growth_plus), их состав и цены, список услуг с ключами и ценами для кастомных КП, разовые услуги (addons), типы оплаты и правила состава (notes). Вызови это ПЕРЕД созданием кастомного КП, чтобы знать правильные selectionKey и не называть клиенту цену по памяти: прайс меняется, а ответ каталога — единственный его источник. Позиции с tierPricing (аудит, стратегия, модель ПЛ) стоят по-разному в зависимости от revenueTier.",
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
    "плюс премия 15% от прироста выручки CRM над бейзлайном (с минималкой — не меньше 80к/мес при приросте от 5%; kpiNoMinBonus=true — чистые 15% с первого рубля). Возвращает публичную ссылку на КП и ссылку на PDF.\n\n" +
    "kpiBaseline — история CRM-канала по месяцам из отчёта Mindbox (лучше 24 месяца, последний — последний ЗАКРЫТЫЙ), выручка в МИЛЛИОНАХ ₽ (2 739 401 ₽ → 2.74). Бейзлайн портал считает сам (метод 2: уровень × сезонность × затухающий темп, обвалы находит сам).\n" +
    "ВАЖНО: повторный вызов по той же сделке ПЕРЕЗАПИСЫВАЕТ существующее КП, сохраняя ссылку " +
    "(replaced=true в ответе) — так можно спокойно пересобирать состав, не плодя дубли. " +
    "Нужны два разных КП по одной сделке (например показать клиенту два пакета на выбор) — передай forceNew=true.\n" +
    "Скидка: передай discount + discountReason (причина обязательна) — в КП она ляжет слоем поверх прайс-цены, а в Loop уйдёт алерт. Срок пилота — termMonths.\n" +
    "Логотип: если clientLogo не передан, но есть clientSite — подставится автоматически по домену. " +
    "Если в ответе logoSource=\"none\", логотипа нет — спроси у пользователя ссылку и поставь через set_kp_logo.",
  {
    clientName: z.string().describe("Название клиента/компании"),
    bitrixDealId: z
      .string()
      .describe("ОБЯЗАТЕЛЬНО: числовой id сделки Bitrix24 (КП всегда привязывается к сделке; заполнит её поля пакет/вид проекта + ссылку КП)"),
    clientSite: z.string().optional().describe("Сайт клиента — из него берётся slug и автологотип по домену"),
    clientLogo: z.string().optional().describe("URL логотипа. Не передан — подставится автоматически по clientSite"),
    packageKey: z
      .enum(["lite", "starter", "growth_plus"])
      .describe("lite=Лайт 100к, starter=Старт 150к, growth_plus=Рост 200к"),
    kpiMode: z.boolean().optional().describe("Performance KPI: лимиты ×2 + премия за прирост"),
    kpiNoMinBonus: z
      .boolean()
      .optional()
      .describe(
        "Только при kpiMode=true: премия — чистые 15% от прироста без минималки 80к/мес. Ставь, только если с клиентом так договорились — " +
          "в sales-канал уйдёт алерт. Не передан — у существующего КП не меняется"
      ),
    contract12Months: z
      .boolean()
      .optional()
      .describe("Контракт 12 мес: ТЗ Mindbox бесплатно, мастер-шаблон до 90к включено"),
    paymentType: z
      .enum(["prepay", "postpay0", "postpay7", "postpay14", "postpay30", "postpay45"])
      .optional()
      .describe("Тип оплаты (наценка за постоплату)"),
    revenueTier: z
      .enum(["up_to_1m", "above_1m"])
      .optional()
      .describe(
        "Размер базы клиента: up_to_1m = до 1 млн, above_1m = от 1 млн. Влияет на цену аудита (150к/250к), стратегии автоматизации (500к/750к) и модели ПЛ (600к/900к)"
      ),
    addOns: z
      .record(z.object({ qty: z.number().int().positive().optional() }))
      .optional()
      .describe(
        "Разовые услуги. Ключи: strategy_audit, strategy_automation_strategy, strategy_loyalty_model, strategy_mindbox_setup, design_universal_template (qty = блоки шаблона). " +
          "strategy_audit и strategy_automation_strategy взаимоисключающие — аудит целиком входит в стратегию; пришлёшь обе, останется стратегия. " +
          "Цена аудита и стратегии зависит от revenueTier, плоской цены у них больше нет"
      ),
    // Каналы внутри пакета (портал, sales-portal#458, 06.10.2026). Здесь
    // проверяем только форму: правила пакета (слоты, дробление) живут на
    // портале в одном месте — продублируй их тут, и при правке правил копии
    // разойдутся. Нарушение правил портал вернёт 422 с понятным текстом.
    channels: z
      .object({
        triggers: z
          .array(
            z.array(
              z.object({
                channel: z.enum(["email", "mobile_push", "webpush", "sms", "in_app", "chatbots"]),
                qty: z.number().int().positive(),
              })
            )
          )
          .describe("Триггеры: массив слотов, в каждом — каналы со штуками"),
        campaigns: z
          .array(
            z.array(
              z.object({
                channel: z.enum(["email", "push", "messenger", "sms"]),
                qty: z.number().int().positive(),
              })
            )
          )
          .describe("Массовые рассылки: массив слотов, в каждом — каналы со штуками"),
      })
      .nullable()
      .optional()
      .describe(
        "Каналы внутри пакета: заменить email на другой канал или раздробить. Цена пакета не меняется. " +
          "Триггеры и рассылки — независимые блоки; блок = массив слотов, сумма штук в слоте фиксирована пакетом:\n" +
          "• lite: triggers 1 слот × 4 шт, campaigns 1 слот × 4 шт — канал можно заменить, дробить нельзя;\n" +
          "• starter: triggers 1 слот × 5, campaigns 1 слот × 8 — слот можно раздробить на любые каналы (каждый ≥1 шт);\n" +
          "• growth_plus: triggers 2 слота × 5, campaigns 2 слота × 10 — каждую половину можно заменить, ОДНУ половину блока раздробить на 2 канала.\n" +
          "Пример starter (3 email + 2 SMS триггера, все рассылки в SMS): " +
          '{"triggers":[[{"channel":"email","qty":3},{"channel":"sms","qty":2}]],"campaigns":[[{"channel":"sms","qty":8}]]}. ' +
          "Не передан — у существующего КП того же пакета каналы сохраняются; null — вернуть каналы пакета по каталогу (email / email+push)"
      ),
    tasks: z.array(z.string()).max(8).optional().describe("Задачи клиента (буллеты)"),
    forceNew: z
      .boolean()
      .optional()
      .describe("Создать НОВОЕ КП вместо перезаписи существующего по этой сделке (два варианта клиенту на выбор)"),
    vertical: z.string().optional().describe("Сегмент: fashion/ecom/horeca/retail/beauty/b2b/saas/general"),
    termMonths: z
      .number()
      .int()
      .min(1)
      .max(24)
      .nullable()
      .optional()
      .describe(
        "Срок проекта в месяцах (1-24) — для пилотов и разовых проектов. Не передан = поле не трогаем " +
          "(у существующего КП срок сохранится). Передай null, чтобы СНЯТЬ срок и сделать проект бессрочным. " +
          "Не путать со сроком скидки — он задаётся через discount.untilDate"
      ),
    discount: z
      .object({
        type: z.enum(["percent", "fixed"]).describe("percent = % от стоимости, fixed = сумма в ₽"),
        value: z.number().min(0).describe("Для percent — проценты, для fixed — рубли"),
        untilDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional()
          .describe("Дата окончания скидки YYYY-MM-DD. Пусто = до конца года от старта"),
      })
      .optional()
      .describe("Скидка на КП. Вместе с ней ОБЯЗАТЕЛЬНА discountReason, иначе 422"),
    discountReason: z
      .string()
      .optional()
      .describe("Причина скидки — обязательна при discount. Уходит алертом в Loop вместе со ссылкой на КП"),
    // Метод 2 бейзлайна (портал, sales-portal#467, 07.10.2026). Старый формат
    // {prevYearMonthly, recent3Monthly} портал ещё принимает, но здесь его
    // нет намеренно: он завышал бейзлайн вдвое при обвале у клиента (Пироги
    // №1), и агент не должен им пользоваться для новых КП.
    kpiBaseline: z
      .object({
        withKpi: z.boolean(),
        method: z.literal(2).describe("Всегда 2"),
        history: z
          .array(
            z.object({
              ym: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe("Месяц ГГГГ-ММ"),
              value: z.number().nonnegative().describe("Выручка CRM-канала за месяц, в МИЛЛИОНАХ ₽"),
            })
          )
          .min(12)
          .max(36)
          .describe(
            "Выручка CRM-канала по месяцам подряд, без пропусков, от старых к новым; 12–36 месяцев, лучше 24 " +
              "(без двух лет сезонность не считается). Последний — последний ЗАКРЫТЫЙ месяц, текущий не передавать"
          ),
        baseRate: z.number().describe("Базовая ставка, тыс ₽/мес"),
        contractMonths: z.number().describe("Срок контракта, мес"),
      })
      .superRefine((k, ctx) => {
        const err = kpiUnitsError(k);
        if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err, path: ["history"] });
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
    "чтобы получить правильные selectionKey и актуальные цены. Возвращает публичную ссылку и PDF.\n\n" +
    "Состав КП сервер нормализует: аудит и стратегия автоматизации взаимоисключающие, а «Сопровождение проекта» " +
    "включается само под любую услугу кроме них двоих (и снимается, если в КП только аудит и/или стратегия). " +
    "Итоговый состав смотри по ссылке КП, а не по тому, что отправил.\n\n" +
    "ВАЖНО: повторный вызов по той же сделке ПЕРЕЗАПИСЫВАЕТ существующее КП, сохраняя ссылку " +
    "(replaced=true в ответе). Нужно второе КП по той же сделке — forceNew=true.\n" +
    "Скидка: передай discount + discountReason (причина обязательна) — в КП она ляжет слоем поверх прайс-цены, а в Loop уйдёт алерт. Срок пилота — termMonths.\n" +
    "Логотип: не передан clientLogo, но есть clientSite — подставится по домену. " +
    "logoSource=\"none\" в ответе — логотипа нет, спроси ссылку у пользователя и поставь через set_kp_logo.",
  {
    clientName: z.string().describe("Название клиента"),
    bitrixDealId: z
      .string()
      .describe("ОБЯЗАТЕЛЬНО: числовой id сделки Bitrix24 (КП всегда привязывается к сделке; заполнит её поля + ссылку КП)"),
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
      .describe(
        "Карта услуг: { selectionKey: { status, hours?, qty? } }. Ключи из get_catalog.\n" +
          "Два правила состава применяются на сервере, спорить с ними бесполезно:\n" +
          "1) strategy_audit и strategy_automation_strategy не совмещаются — аудит входит в стратегию целиком, пришлёшь обе, аудит снимется;\n" +
          "2) management_base («Сопровождение проекта») проставляется сам, как только в КП есть хоть одна услуга кроме аудита и стратегии, и наоборот — снимается вместе с management_monthly_analysis, если в КП только аудит и/или стратегия. Разовую консультацию не сопровождают, и менеджмент за 30-60к в такое КП попасть не должен."
      ),
    revenueTier: z
      .enum(["up_to_1m", "above_1m"])
      .optional()
      .describe(
        "Размер базы клиента: up_to_1m = до 1 млн (дефолт), above_1m = от 1 млн. Влияет на цену аудита (150к/250к), стратегии автоматизации (500к/750к) и модели ПЛ (600к/900к)"
      ),
    mode: z.enum(["hours", "mechanics"]).optional().describe("Режим расчёта автоматизаций"),
    projectType: z.enum(["regular", "oneoff"]).optional().describe("regular=ежемесячно, oneoff=разовый проект"),
    paymentType: z.enum(["prepay", "postpay0", "postpay7", "postpay14", "postpay30", "postpay45"]).optional(),
    contract12Months: z.boolean().optional(),
    forceNew: z
      .boolean()
      .optional()
      .describe("Создать НОВОЕ КП вместо перезаписи существующего по этой сделке"),
    termMonths: z
      .number()
      .int()
      .min(1)
      .max(24)
      .nullable()
      .optional()
      .describe(
        "Срок проекта в месяцах (1-24) — для пилотов и разовых проектов. Не передан = поле не трогаем " +
          "(у существующего КП срок сохранится). Передай null, чтобы СНЯТЬ срок и сделать проект бессрочным. " +
          "Не путать со сроком скидки — он задаётся через discount.untilDate"
      ),
    discount: z
      .object({
        type: z.enum(["percent", "fixed"]).describe("percent = % от стоимости, fixed = сумма в ₽"),
        value: z.number().min(0).describe("Для percent — проценты, для fixed — рубли"),
        untilDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional()
          .describe("Дата окончания скидки YYYY-MM-DD. Пусто = до конца года от старта"),
      })
      .optional()
      .describe("Скидка на КП. Вместе с ней ОБЯЗАТЕЛЬНА discountReason, иначе 422"),
    discountReason: z
      .string()
      .optional()
      .describe("Причина скидки — обязательна при discount. Уходит алертом в Loop вместе со ссылкой на КП"),
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

const transport = new StdioServerTransport();
await server.connect(transport);
// eslint-disable-next-line no-console
console.error(`clientcore-mcp подключён · ${BASE_URL}`);
