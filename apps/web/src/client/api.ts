import type {
  AppConfig,
  AppConfigPatch,
  AuthStatus,
  QrLoginSession,
  DownloadCreateRequest,
  DownloadCreateResult,
  FileEntry,
  HistoryEntryDto,
  MediaOptionSummary,
  ParseHistoryEntry,
  ParseRequest,
  ParseResult,
  TaskSummary,
} from "./types.js";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly duplicates: Array<{ itemId: string; title: string }> | undefined;

  constructor(status: number, code: string, message: string, duplicates?: Array<{ itemId: string; title: string }>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.duplicates = duplicates;
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
}

export class ApiClient {
  readonly #baseUrl: string;

  constructor(options: ApiClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
  }

  async health(): Promise<{ ok: boolean }> {
    return this.#request("/api/health");
  }

  async parse(request: ParseRequest): Promise<ParseResult[]> {
    const body = await this.#request<{ results: ParseResult[] }>("/api/parse", {
      method: "POST",
      body: request,
    });
    return body.results;
  }

  async mediaOptions(itemId: string): Promise<MediaOptionSummary> {
    return this.#request(`/api/media/${encodeURIComponent(itemId)}`);
  }

  async createDownload(request: DownloadCreateRequest): Promise<DownloadCreateResult> {
    return this.#request("/api/download", { method: "POST", body: request });
  }

  async listTasks(): Promise<TaskSummary[]> {
    const body = await this.#request<{ tasks: TaskSummary[] }>("/api/tasks");
    return body.tasks;
  }

  async getTask(id: string): Promise<TaskSummary> {
    return this.#request(`/api/tasks/${encodeURIComponent(id)}`);
  }

  async taskLog(id: string): Promise<string[]> {
    const body = await this.#request<{ lines: string[] }>(`/api/tasks/${encodeURIComponent(id)}/log`);
    return body.lines;
  }

  async cancelTask(id: string): Promise<void> {
    await this.#request(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  }

  async pauseTask(id: string): Promise<void> {
    await this.#request(`/api/tasks/${encodeURIComponent(id)}/pause`, { method: "POST" });
  }

  async resumeTask(id: string): Promise<void> {
    await this.#request(`/api/tasks/${encodeURIComponent(id)}/resume`, { method: "POST" });
  }

  async retryTask(id: string): Promise<void> {
    await this.#request(`/api/tasks/${encodeURIComponent(id)}/retry`, { method: "POST" });
  }

  async deleteTask(id: string): Promise<void> {
    await this.#request(`/api/tasks/${encodeURIComponent(id)}/delete`, { method: "POST" });
  }

  async listHistory(): Promise<HistoryEntryDto[]> {
    const body = await this.#request<{ history: HistoryEntryDto[] }>("/api/history");
    return body.history;
  }

  async deleteHistory(taskId: string): Promise<void> {
    await this.#request(`/api/history/${encodeURIComponent(taskId)}`, { method: "DELETE" });
  }

  async listFiles(): Promise<FileEntry[]> {
    const body = await this.#request<{ files: FileEntry[] }>("/api/files");
    return body.files;
  }

  async listParseHistory(): Promise<ParseHistoryEntry[]> {
    const body = await this.#request<{ history: ParseHistoryEntry[] }>("/api/parse-history");
    return body.history;
  }

  async deleteParseHistory(id: number): Promise<void> {
    await this.#request(`/api/parse-history/${id}`, { method: "DELETE" });
  }

  async getConfig(): Promise<AppConfig> {
    const body = await this.#request<{ config: AppConfig }>("/api/config");
    return body.config;
  }

  async updateConfig(config: AppConfigPatch): Promise<AppConfig> {
    const body = await this.#request<{ config: AppConfig }>("/api/config", {
      method: "PUT",
      body: { config },
    });
    return body.config;
  }

  async authStatus(): Promise<AuthStatus> {
    return this.#request("/api/auth/status");
  }

  async qrLoginStart(): Promise<QrLoginSession> {
    return this.#request<QrLoginSession>("/api/auth/qr", { method: "POST" });
  }

  async qrLoginPoll(qrcodeKey: string): Promise<QrLoginSession> {
    return this.#request<QrLoginSession>("/api/auth/qr/poll", { method: "POST", body: { qrcodeKey } });
  }

  async loginWithSessdata(sessdata: string): Promise<AuthStatus> {
    return this.#request<AuthStatus>("/api/auth", { method: "POST", body: { sessdata } });
  }

  async logout(): Promise<AuthStatus> {
    return this.#request<AuthStatus>("/api/auth", { method: "DELETE" });
  }

  fileUrl(path: string): string {
    return `${this.#baseUrl}/api/files/raw?path=${encodeURIComponent(path)}`;
  }

  openTaskEvents(id: string, onUpdate: (task: TaskSummary) => void, onError?: (event: Event) => void): () => void {
    if (typeof EventSource === "undefined") return () => undefined;
    const source = new EventSource(`${this.#baseUrl}/api/tasks/${encodeURIComponent(id)}/events`);
    source.addEventListener("task", (event) => {
      try {
        onUpdate(JSON.parse((event as MessageEvent<string>).data) as TaskSummary);
      } catch {
        // Ignore malformed SSE frames; polling still refreshes the task.
      }
    });
    if (onError) source.addEventListener("error", onError);
    return () => source.close();
  }

  async #request<T = unknown>(
    path: string,
    init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${this.#baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await response.text();
    let payload: unknown = undefined;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = undefined;
      }
    }
    if (!response.ok) {
      const errorBody = payload as { error?: { code?: string; message?: string; duplicates?: Array<{ itemId: string; title: string }> } } | undefined;
      throw new ApiError(
        response.status,
        errorBody?.error?.code ?? "UNKNOWN",
        errorBody?.error?.message ?? `请求失败（HTTP ${response.status}）`,
        errorBody?.error?.duplicates,
      );
    }
    return payload as T;
  }
}

export const api = new ApiClient();