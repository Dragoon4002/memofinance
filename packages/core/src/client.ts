const TIMEOUT_MS = 15_000;

export class OkxRestClient {
  private baseUrl: string;

  constructor(baseUrl = process.env.OKX_BASE_URL ?? "https://www.okx.com") {
    this.baseUrl = baseUrl;
  }

  async publicGet(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        signal: ctrl.signal,
        headers: { "User-Agent": "memofinance-asp/0.1" },
      });
      if (!res.ok) throw new Error(`OKX API ${res.status}: ${await res.text()}`);
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
