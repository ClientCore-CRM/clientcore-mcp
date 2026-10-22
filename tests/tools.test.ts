import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.js";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function connect(token: string, env: Record<string, string | undefined> = {}) {
  const server = await buildServer(token, env);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const names = async (c: Client) => (await c.listTools()).tools.map((t) => t.name);
const textOf = (r: any) => r.content[0].text as string;

afterEach(() => vi.unstubAllGlobals());

describe("набор инструментов по установке", () => {
  it("ClientCore (cc-services)", async () => {
    const f = vi.fn(async () => json({ engine: "cc-services", packages: [] }));
    vi.stubGlobal("fetch", f);
    const c = await connect("cck_abc");
    expect(await names(c)).toEqual(["get_catalog", "create_package_kp", "create_custom_kp", "set_kp_logo", "create_share_link"]);
    expect(c.getInstructions()).toContain("Калькулятор КП ClientCore");
    expect(f.mock.calls[0][0]).toBe("https://offer.clientcore.ru/api/v1/catalog");
    expect((f.mock.calls[0] as any)[1].headers.Authorization).toBe("Bearer cck_abc");
    expect(c.getServerVersion()?.name).toBe("calculator-mcp");
  });

  it("Retail Rocket (rr-cdp)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ engine: "rr-cdp" })));
    const c = await connect("rrk_abc");
    expect(await names(c)).toEqual(["kp_catalog", "quote_kp", "create_kp", "set_kp_logo", "create_share_link"]);
    expect(c.getInstructions()).toContain("Калькулятор КП Retail Rocket");
  });

  it("401 каталога - только calculator_status с текстом портала", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "Токен недействителен или отозван." }, 401)));
    const c = await connect("cck_dead");
    expect(await names(c)).toEqual(["calculator_status"]);
    const r = await c.callTool({ name: "calculator_status", arguments: {} });
    expect(textOf(r)).toContain("Токен недействителен или отозван.");
  });

  it("портал недоступен - calculator_status говорит «нет связи»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const c = await connect("rrk_abc");
    expect(await names(c)).toEqual(["calculator_status"]);
    const r = await c.callTool({ name: "calculator_status", arguments: {} });
    expect(textOf(r)).toContain("нет связи с https://rrsales.clientcore.ru");
  });

  it("неизвестный движок - calculator_status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ engine: "zzz" })));
    const c = await connect("cck_abc");
    expect(await names(c)).toEqual(["calculator_status"]);
    expect(textOf(await c.callTool({ name: "calculator_status", arguments: {} }))).toContain("zzz");
  });
});

describe("вызовы РР", () => {
  it("quote_kp шлёт engineInput с integration в /kp/quote и отдаёт ответ", async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith("/catalog") ? json({ engine: "rr-cdp" }) : json({ integration: { months: 2, discountPct: 50 }, year: 1000 })
    );
    vi.stubGlobal("fetch", f);
    const c = await connect("rrk_abc");
    const input = { tabs: { main: true }, users: 1000, integration: { months: 2, discountPct: 50 } };
    const r = await c.callTool({ name: "quote_kp", arguments: { engineInput: input } });
    const call = f.mock.calls.find((x) => String(x[0]).endsWith("/api/v1/kp/quote"))!;
    expect(JSON.parse((call as any)[1].body)).toEqual({ engineInput: input });
    expect(JSON.parse(textOf(r)).integration.months).toBe(2);
  });

  it("create_kp шлёт engine rr-cdp в /kp", async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith("/catalog") ? json({ engine: "rr-cdp" }) : json({ ok: true, url: "https://x/kp/a" })
    );
    vi.stubGlobal("fetch", f);
    const c = await connect("rrk_abc");
    await c.callTool({ name: "create_kp", arguments: { dealId: "123", clientName: "ACME", engineInput: { users: 1 } } });
    const call = f.mock.calls.find((x) => String(x[0]).endsWith("/api/v1/kp"))!;
    expect(JSON.parse((call as any)[1].body)).toEqual({ engine: "rr-cdp", dealId: "123", clientName: "ACME", engineInput: { users: 1 } });
  });

  it("ошибка портала возвращается как error", async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith("/catalog") ? json({ engine: "rr-cdp" }) : json({ error: "Скидка без причины" }, 422)
    );
    vi.stubGlobal("fetch", f);
    const c = await connect("rrk_abc");
    const r = await c.callTool({ name: "quote_kp", arguments: { engineInput: {} } });
    expect(JSON.parse(textOf(r))).toEqual({ error: true, status: 422, details: { error: "Скидка без причины" } });
  });
});

describe("вызовы ClientCore", () => {
  it("create_package_kp идёт в /kp/package как раньше", async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith("/catalog") ? json({ engine: "cc-services" }) : json({ ok: true })
    );
    vi.stubGlobal("fetch", f);
    const c = await connect("cck_abc");
    await c.callTool({ name: "create_package_kp", arguments: { clientName: "A", bitrixDealId: "1", packageKey: "lite" } });
    const call = f.mock.calls.find((x) => String(x[0]).endsWith("/api/v1/kp/package"))!;
    expect(JSON.parse((call as any)[1].body)).toEqual({ clientName: "A", bitrixDealId: "1", packageKey: "lite" });
  });

  it("выручка KPI в рублях отклоняется на клиенте", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ engine: "cc-services" })));
    const c = await connect("cck_abc");
    const history = Array.from({ length: 12 }, (_, i) => ({ ym: `2025-${String(i + 1).padStart(2, "0")}`, value: 2_739_401 }));
    const r: any = await c.callTool({
      name: "create_package_kp",
      arguments: {
        clientName: "A", bitrixDealId: "1", packageKey: "lite", kpiMode: true,
        kpiBaseline: { withKpi: true, method: 2, history, baseRate: 1, contractMonths: 12 },
      },
    });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("млн ₽");
  });
});
