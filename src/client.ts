export interface GrafanaConfig {
  url: string;
  token?: string;
  username?: string;
  password?: string;
  orgId?: number;
}

export interface RequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * Lightweight Grafana HTTP client that supports token-based and basic auth.
 * Uses the native Node.js fetch API (available since Node 18).
 */
export class GrafanaClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly rejectUnauthorized: boolean;

  constructor(config: GrafanaConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.rejectUnauthorized =
      process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0";

    // Disable TLS verification globally when configured to do so.
    // Node.js native fetch (undici) does not accept https.Agent as dispatcher;
    // setting the process env variable is the reliable cross-version approach.
    if (!this.rejectUnauthorized) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }

    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (config.token) {
      this.headers["Authorization"] = `Bearer ${config.token}`;
    } else if (config.username && config.password) {
      const encoded = Buffer.from(
        `${config.username}:${config.password}`
      ).toString("base64");
      this.headers["Authorization"] = `Basic ${encoded}`;
    }

    if (config.orgId && config.orgId !== 1) {
      this.headers["X-Grafana-Org-Id"] = String(config.orgId);
    }
  }

  private buildUrl(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const url = this.buildUrl(options.path, options.params);
    const method = options.method ?? "GET";

    const fetchOptions: RequestInit = {
      method,
      headers: this.headers as HeadersInit,
    };

    if (options.body !== undefined) {
      (fetchOptions as RequestInit).body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(
        `Grafana API error ${response.status} ${response.statusText}: ${errorText}`
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json() as Promise<T>;
    }
    return response.text() as unknown as T;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    return this.request<T>({ path, params });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "POST", path, body });
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "PUT", path, body });
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: "PATCH", path, body });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>({ method: "DELETE", path });
  }
}
