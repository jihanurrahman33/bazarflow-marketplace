type Handler = (req: Request, ctx: { params: Promise<any> }) => Promise<Response>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface CallOptions {
  method?: string;
  body?: unknown;
  rawBody?: string;
  token?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  query?: Record<string, string | number>;
}

export interface ApiResult<T = any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  status: number;
  json: { data?: T; meta?: Record<string, any>; error?: { code: string; message: string; details: { field: string; code: string }[]; requestId: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Headers;
  data: T;
  error?: { code: string; message: string; details: { field: string; code: string }[]; requestId: string };
}

export async function call<T = any>(handler: Handler, opts: CallOptions = {}): Promise<ApiResult<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const qs = opts.query ? "?" + new URLSearchParams(Object.entries(opts.query).map(([k, v]) => [k, String(v)])).toString() : "";
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const hasBody = opts.body !== undefined || opts.rawBody !== undefined;
  if (hasBody && !headers["content-type"]) headers["content-type"] = "application/json";
  const req = new Request(`http://localhost:3000/api/v1/test${qs}`, {
    method: opts.method ?? "GET",
    headers,
    body: hasBody ? (opts.rawBody ?? JSON.stringify(opts.body)) : undefined,
  });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = res.status === 204 ? "" : await res.text();
  const json = text ? JSON.parse(text) : {};
  return { status: res.status, json, headers: res.headers, data: json.data, error: json.error };
}
