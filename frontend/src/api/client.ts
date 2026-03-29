import axios from "axios";

const http = axios.create({
  baseURL: "/",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const requestUrl = String(error?.config?.url || "");
    if (
      status === 401 &&
      typeof window !== "undefined" &&
      requestUrl.startsWith("/api/") &&
      !requestUrl.startsWith("/api/auth/login") &&
      !requestUrl.startsWith("/api/auth/csrf")
    ) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.assign(`/login?next=${next}`);
    }
    return Promise.reject(error);
  },
);

let csrfToken: string | null = null;

export type ThemeName = "system" | "github-inspired" | "discord-inspired" | "plex-inspired";

export type AuthStatusResponse = {
  ok: boolean;
  csrf_token: string;
  auth_enabled: boolean;
  authenticated: boolean;
  setup_complete: boolean;
  theme: ThemeName;
  auth_username?: string;
  env_password_locked?: boolean;
};

async function ensureCsrfToken() {
  if (csrfToken) {
    return csrfToken;
  }

  const { data } = await http.get<AuthStatusResponse>("/api/auth/csrf");

  csrfToken = data.csrf_token;
  return csrfToken;
}

async function postWithCsrf<TResponse>(url: string, payload: unknown) {
  const token = await ensureCsrfToken();
  const { data } = await http.post<TResponse>(url, payload, {
    headers: {
      "X-CSRF-Token": token,
    },
  });
  return data;
}

async function patchWithCsrf<TResponse>(url: string, payload: unknown) {
  const token = await ensureCsrfToken();
  const { data } = await http.patch<TResponse>(url, payload, {
    headers: {
      "X-CSRF-Token": token,
    },
  });
  return data;
}

async function deleteWithCsrf<TResponse>(url: string) {
  const token = await ensureCsrfToken();
  const { data } = await http.delete<TResponse>(url, {
    headers: {
      "X-CSRF-Token": token,
    },
  });
  return data;
}

export type ApiState = {
  running: boolean;
  last_run: string | null;
  next_run: string | null;
  cycle_count: number;
  total_searches: number;
  daily_count: number;
  daily_limit: number;
  daily_remaining: number | null;
  server_time: string;
  server_tz: string;
  activity_log: Array<{
    ts: string;
    service: string;
    action: string;
    item: string;
    status: "info" | "success" | "warning" | "error";
  }>;
  inst_stats: Record<
    string,
    {
      missing_found: number;
      missing_searched: number;
      upgrades_found: number;
      upgrades_searched: number;
      status: string;
      version: string;
      queue_size: number;
      status_detail?: string;
    }
  >;
  instances: Array<{
    id: string;
    type: "sonarr" | "radarr";
    name: string;
    url: string;
    enabled: boolean;
  }>;
  config: {
    hunt_missing_delay: number;
    max_searches_per_run: number;
    daily_limit: number;
    cooldown_days: number;
    request_timeout: number;
    jitter_max: number;
    sonarr_search_mode: "episode" | "season" | "series";
    search_upgrades: boolean;
    scan_interval_days: number;
    timezone: string;
    auto_start: boolean;
    dry_run: boolean;
    instance_count: number;
    theme: ThemeName;
    discord?: {
      enabled?: boolean;
      notify_missing?: boolean;
      notify_upgrade?: boolean;
      notify_cooldown?: boolean;
      notify_limit?: boolean;
      notify_offline?: boolean;
      notify_stats?: boolean;
      stats_interval_min?: number;
      rate_limit_cooldown?: number;
    };
    discord_configured?: boolean;
    discord_webhook_set?: boolean;
  };
};

export type SetupInstancePayload = {
  id?: string;
  type: "sonarr" | "radarr";
  name: string;
  url: string;
  api_key: string;
};

export type SetupCompletePayload = {
  instances: SetupInstancePayload[];
  theme?: ThemeName;
  auth?: {
    username: string;
    password: string;
  };
  discord?: {
    webhook_url: string;
    notify_missing?: boolean;
    notify_upgrade?: boolean;
    notify_cooldown?: boolean;
    notify_limit?: boolean;
    notify_offline?: boolean;
  };
};

export type ConfigUpdatePayload = {
  hunt_missing_delay?: number;
  max_searches_per_run?: number;
  daily_limit?: number;
  cooldown_days?: number;
  request_timeout?: number;
  jitter_max?: number;
  sonarr_search_mode?: "episode" | "season" | "series";
  search_upgrades?: boolean;
  scan_interval_days?: number;
  timezone?: string;
  auto_start?: boolean;
  dry_run?: boolean;
  discord?: {
    enabled?: boolean;
    webhook_url?: string;
    notify_missing?: boolean;
    notify_upgrade?: boolean;
    notify_cooldown?: boolean;
    notify_limit?: boolean;
    notify_offline?: boolean;
    notify_stats?: boolean;
    stats_interval_min?: number;
    rate_limit_cooldown?: number;
  };
};

export type InstanceRecord = {
  id: string;
  type: "sonarr" | "radarr";
  name: string;
  url: string;
  enabled: boolean;
};

export type InstanceCreatePayload = {
  type: "sonarr" | "radarr";
  name: string;
  url: string;
  api_key: string;
};

export type InstanceUpdatePayload = {
  type?: "sonarr" | "radarr";
  name?: string;
  url?: string;
  api_key?: string;
  enabled?: boolean;
};

export type HistoryItem = {
  id: number;
  service: string;
  item_type: string;
  item_id: number;
  title: string;
  searched_at: string;
  result: string;
  search_count: number;
  ago_label?: string;
  expires_label?: string;
  instance_name?: string;
  instance_type?: string;
};

export type HistoryResponse = {
  ok: boolean;
  count: number;
  history: HistoryItem[];
};

export type HistoryStatsResponse = {
  ok: boolean;
  total: number;
  today: number;
  by_service: Record<string, { total?: number; total_attempts?: number; last_search?: string }>;
  by_year: Array<{ release_year: number; count: number }>;
};

export const api = {
  async getAuthStatus() {
    const { data } = await http.get<AuthStatusResponse>("/api/auth/csrf");
    csrfToken = data.csrf_token;
    return data;
  },

  async login(payload: { username?: string; password: string; next?: string; theme?: ThemeName }) {
    return postWithCsrf<{ ok: boolean; target?: string; error?: string }>("/api/auth/login", payload);
  },

  async logout() {
    return postWithCsrf<{ ok: boolean }>("/api/auth/logout", {});
  },

  async getState() {
    const { data } = await http.get<ApiState>("/api/state");
    return data;
  },

  async control(action: "start" | "stop" | "run_now") {
    return postWithCsrf<{ ok: boolean }>("/api/control", { action });
  },

  async updateConfig(payload: ConfigUpdatePayload) {
    return postWithCsrf<{ ok: boolean; error?: string }>("/api/config", payload);
  },

  async updateDiscordConfig(payload: NonNullable<ConfigUpdatePayload["discord"]>) {
    return postWithCsrf<{ ok: boolean; error?: string }>("/api/config", { discord: payload });
  },

  async testDiscord() {
    return postWithCsrf<{ ok: boolean; error?: string }>("/api/discord/test", {});
  },

  async getTimezones() {
    const { data } = await http.get<{ ok: boolean; timezones: string[] }>("/api/timezones");
    return data;
  },

  async addInstance(payload: InstanceCreatePayload) {
    return postWithCsrf<{ ok: boolean; id?: string; error?: string; errors?: string[] }>("/api/instances", payload);
  },

  async updateInstance(instanceId: string, payload: InstanceUpdatePayload) {
    return patchWithCsrf<{ ok: boolean; error?: string }>(`/api/instances/${instanceId}`, payload);
  },

  async deleteInstance(instanceId: string) {
    return deleteWithCsrf<{ ok: boolean; error?: string }>(`/api/instances/${instanceId}`);
  },

  async pingInstance(instanceId: string) {
    const { data } = await http.get<{ ok: boolean; version?: string; msg?: string }>(`/api/instances/${instanceId}/ping`);
    return data;
  },

  async setupPing(payload: { type: "sonarr" | "radarr"; url: string; api_key: string }) {
    return postWithCsrf<{ ok: boolean; version?: string; msg?: string }>("/api/setup/ping", payload);
  },

  async testSetupDiscord(webhook_url: string) {
    return postWithCsrf<{ ok: boolean; error?: string }>("/api/setup/discord/test", { webhook_url });
  },

  async completeSetup(payload: SetupCompletePayload) {
    return postWithCsrf<{ ok: boolean; errors?: string[]; error?: string }>("/api/setup/complete", payload);
  },

  async getHistory(params: { service?: string; cooldownOnly?: boolean } = {}) {
    const { data } = await http.get<HistoryResponse>("/api/history", {
      params: {
        service: params.service ?? "",
        cooldown_only: params.cooldownOnly ? "1" : "0",
      },
    });
    return data;
  },

  async getHistoryStats() {
    const { data } = await http.get<HistoryStatsResponse>("/api/history/stats");
    return data;
  },

  async clearHistory() {
    return postWithCsrf<{ ok: boolean; removed?: number }>("/api/history/clear", {});
  },

  async clearHistoryForInstance(instanceId: string) {
    return postWithCsrf<{ ok: boolean; removed?: number }>(`/api/history/clear/${instanceId}`, {});
  },
};
