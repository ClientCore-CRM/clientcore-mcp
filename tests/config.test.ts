import { describe, expect, it } from "vitest";
import { baseUrlFor, readToken, toolsetFor } from "../src/config.js";

describe("readToken", () => {
  it("читает старую CLIENTCORE_API_TOKEN", () => {
    expect(readToken({ CLIENTCORE_API_TOKEN: "cck_x" })).toBe("cck_x");
  });
  it("новая CALCULATOR_API_TOKEN главнее старой", () => {
    expect(readToken({ CALCULATOR_API_TOKEN: "rrk_y", CLIENTCORE_API_TOKEN: "cck_x" })).toBe("rrk_y");
  });
  it("без токена - null", () => {
    expect(readToken({})).toBeNull();
    expect(readToken({ CALCULATOR_API_TOKEN: "  " })).toBeNull();
  });
});

describe("baseUrlFor", () => {
  it("по префиксу ключа", () => {
    expect(baseUrlFor("cck_abc", {})).toBe("https://offer.clientcore.ru");
    expect(baseUrlFor("rrk_abc", {})).toBe("https://rrsales.clientcore.ru");
  });
  it("неизвестный префикс - ClientCore, как раньше", () => {
    expect(baseUrlFor("legacy_abc", {})).toBe("https://offer.clientcore.ru");
  });
  it("CALCULATOR_BASE_URL перекрывает и режет хвостовой слэш", () => {
    expect(baseUrlFor("rrk_abc", { CALCULATOR_BASE_URL: "http://localhost:3000/" })).toBe("http://localhost:3000");
  });
});

describe("baseUrlFor, прежняя переменная", () => {
  it("CLIENTCORE_BASE_URL читается для cck_ и неизвестного префикса, если новой нет", () => {
    expect(baseUrlFor("cck_abc", { CLIENTCORE_BASE_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(baseUrlFor("legacy_abc", { CLIENTCORE_BASE_URL: "http://localhost:3000/" })).toBe("http://localhost:3000");
    expect(baseUrlFor("cck_abc", { CALCULATOR_BASE_URL: "http://a", CLIENTCORE_BASE_URL: "http://b" })).toBe("http://a");
  });
  it("CLIENTCORE_BASE_URL никогда не перекрывает адрес ключа rrk_", () => {
    expect(baseUrlFor("rrk_abc", { CLIENTCORE_BASE_URL: "https://offer.clientcore.ru" })).toBe("https://rrsales.clientcore.ru");
  });
  it("CALCULATOR_BASE_URL перекрывает и для rrk_, даже при заданной CLIENTCORE_BASE_URL", () => {
    expect(baseUrlFor("rrk_abc", { CALCULATOR_BASE_URL: "http://stand", CLIENTCORE_BASE_URL: "https://offer.clientcore.ru" })).toBe("http://stand");
  });
});

describe("toolsetFor", () => {
  it("по движку каталога", () => {
    expect(toolsetFor("cc-services")).toBe("cc");
    expect(toolsetFor("rr-cdp")).toBe("rr");
    expect(toolsetFor(null)).toBe("status");
    expect(toolsetFor("other")).toBe("status");
  });
});
