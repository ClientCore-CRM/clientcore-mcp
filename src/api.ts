export type ApiResult = { ok: boolean; status: number; data: unknown };
export type Api = (method: "GET" | "POST", path: string, body?: unknown) => Promise<ApiResult>;

/** Таймаут обычного вызова: создание КП бывает медленным, но вечно висеть не должно. */
export const CALL_TIMEOUT_MS = 60_000;

export function makeApi(baseUrl: string, token: string, timeoutMs: number = CALL_TIMEOUT_MS): Api {
  return async (method, path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = { error: `HTTP ${res.status}` };
    }
    return { ok: res.ok, status: res.status, data };
  };
}

export function asText(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}
