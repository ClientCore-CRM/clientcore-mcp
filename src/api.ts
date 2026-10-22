export type ApiResult = { ok: boolean; status: number; data: unknown };
export type Api = (method: "GET" | "POST", path: string, body?: unknown) => Promise<ApiResult>;

export function makeApi(baseUrl: string, token: string): Api {
  return async (method, path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
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
  };
}

export function asText(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}
