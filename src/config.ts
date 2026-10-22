export type Env = Record<string, string | undefined>;

/** Адрес портала по префиксу ключа; ключ без известного префикса - ClientCore, как у clientcore-mcp. */
export const CC_URL = "https://offer.clientcore.ru";
export const RR_URL = "https://rrsales.clientcore.ru";

/** Токен: CALCULATOR_API_TOKEN, а если его нет - прежний CLIENTCORE_API_TOKEN. */
export function readToken(env: Env): string | null {
  const t = env.CALCULATOR_API_TOKEN?.trim() || env.CLIENTCORE_API_TOKEN?.trim();
  return t || null;
}

/** `cck_` -> портал ClientCore, `rrk_` -> портал Retail Rocket; CALCULATOR_BASE_URL перекрывает выбор для любого ключа; прежняя CLIENTCORE_BASE_URL - только для cck_ и ключей без известного префикса. */
export function baseUrlFor(token: string, env: Env): string {
  const override = env.CALCULATOR_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  const isRr = token.startsWith("rrk_");
  // Прежняя CLIENTCORE_BASE_URL - только для ключей ClientCore: старый конфиг с
  // адресом offer.clientcore.ru и новым rrk_ ключом иначе отправил бы ключ РР на хост ClientCore.
  const legacy = env.CLIENTCORE_BASE_URL?.trim();
  if (legacy && !isRr) return legacy.replace(/\/+$/, "");
  return isRr ? RR_URL : CC_URL;
}

export type Toolset = "cc" | "rr" | "status";

/** Набор инструментов по движку из /api/v1/catalog; нет движка (ошибка каталога) или он незнаком - только статус. */
export function toolsetFor(engine: string | null): Toolset {
  if (engine === "cc-services") return "cc";
  if (engine === "rr-cdp") return "rr";
  return "status";
}
