import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { useTheme } from "../app/providers/ThemeProvider";
import { useNavigate } from "react-router-dom";

const THEMES = [
  {
    key: "system",
    title: "System",
    subtitle: "Follows OS light/dark",
    className: "theme-system",
  },
  {
    key: "github-inspired",
    title: "GitHub",
    subtitle: "Dark code-host style",
    className: "theme-github-inspired",
  },
  {
    key: "discord-inspired",
    title: "Discord",
    subtitle: "Community dark style",
    className: "theme-discord-inspired",
  },
  {
    key: "plex-inspired",
    title: "Plex",
    subtitle: "Cinema amber style",
    className: "theme-plex-inspired",
  },
] as const;

function parseInstanceUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    return {
      protocol: parsed.protocol === "https:" ? "https" as const : "http" as const,
      host: parsed.hostname,
      port: parsed.port,
    };
  } catch {
    return {
      protocol: "http" as const,
      host: rawUrl,
      port: "",
    };
  }
}

function buildInstanceUrl(protocol: "http" | "https", host: string, port: string) {
  const trimmedHost = host.trim();
  const trimmedPort = port.trim();
  return `${protocol}://${trimmedHost}${trimmedPort ? `:${trimmedPort}` : ""}`;
}

function defaultPortForType(type: "sonarr" | "radarr") {
  return type === "sonarr" ? "8989" : "7878";
}

function formatDisplayTime(value: string | null, hourMode: "12" | "24") {
  if (!value || hourMode === "24") {
    return value ?? "-";
  }

  const timeOnly = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
  const dateTime = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/;

  const convertParts = (hoursRaw: string, minutes: string, seconds?: string) => {
    const hours = Number(hoursRaw);
    const suffix = hours >= 12 ? "PM" : "AM";
    const normalized = hours % 12 || 12;
    return `${normalized}:${minutes}${seconds ? `:${seconds}` : ""} ${suffix}`;
  };

  const timeMatch = value.match(timeOnly);
  if (timeMatch) {
    return convertParts(timeMatch[1], timeMatch[2], timeMatch[3]);
  }

  const dateTimeMatch = value.match(dateTime);
  if (dateTimeMatch) {
    return `${dateTimeMatch[1]} ${convertParts(dateTimeMatch[2], dateTimeMatch[3], dateTimeMatch[4])}`;
  }

  return value;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<"dashboard" | "settings" | "instances" | "history">("dashboard");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [hourMode, setHourMode] = useState<"12" | "24">(() => {
    const saved = window.localStorage.getItem("mh-hour-mode");
    return saved === "12" ? "12" : "24";
  });
  const [historyService, setHistoryService] = useState("all");
  const [historyCooldownOnly, setHistoryCooldownOnly] = useState(false);
  const [instanceMessage, setInstanceMessage] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [discordMessage, setDiscordMessage] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [editingInstanceId, setEditingInstanceId] = useState<string | null>(null);
  const [discordDirty, setDiscordDirty] = useState(false);
  const [discordWebhookTouched, setDiscordWebhookTouched] = useState(false);
  const queryClient = useQueryClient();
  const authQuery = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => api.getAuthStatus(),
    retry: false,
    refetchInterval: 30000,
  });

  const shouldLoadState = Boolean(
    authQuery.data &&
      (!authQuery.data.auth_enabled || authQuery.data.authenticated) &&
      authQuery.data.setup_complete,
  );

  const stateQuery = useQuery({
    queryKey: ["state"],
    queryFn: () => api.getState(),
    refetchInterval: 3000,
    enabled: shouldLoadState,
  });

  const controlMutation = useMutation({
    mutationFn: (action: "start" | "stop" | "run_now") => api.control(action),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["state"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      navigate("/login", { replace: true });
    },
  });

  const saveConfigMutation = useMutation({
    mutationFn: api.updateConfig,
    onSuccess: async () => {
      setSettingsDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["state"] });
    },
  });

  const timezonesQuery = useQuery({
    queryKey: ["timezones"],
    queryFn: api.getTimezones,
    staleTime: 1000 * 60 * 30,
  });

  const historyQuery = useQuery({
    queryKey: ["history", historyService, historyCooldownOnly],
    queryFn: () => api.getHistory({
      service: historyService === "all" ? "" : historyService,
      cooldownOnly: historyCooldownOnly,
    }),
    enabled: activeTab === "history",
  });

  const historyStatsQuery = useQuery({
    queryKey: ["history-stats"],
    queryFn: api.getHistoryStats,
    enabled: activeTab === "history",
  });

  const state = stateQuery.data;

  useEffect(() => {
    if (!authQuery.data) {
      return;
    }
    if (authQuery.data.auth_enabled && !authQuery.data.authenticated) {
      navigate("/login?next=%2F", { replace: true });
      return;
    }
    if (!authQuery.data.setup_complete) {
      navigate("/setup", { replace: true });
    }
  }, [authQuery.data, navigate]);

  const [newInstanceForm, setNewInstanceForm] = useState({
    type: "sonarr" as "sonarr" | "radarr",
    name: "",
    protocol: "http" as "http" | "https",
    host: "",
    port: defaultPortForType("sonarr"),
    api_key: "",
  });

  const [editInstanceForm, setEditInstanceForm] = useState({
    type: "sonarr" as "sonarr" | "radarr",
    name: "",
    protocol: "http" as "http" | "https",
    host: "",
    port: "",
    api_key: "",
    enabled: true,
  });

  const [settingsForm, setSettingsForm] = useState({
    hunt_missing_delay: 900,
    max_searches_per_run: 10,
    daily_limit: 20,
    cooldown_days: 7,
    request_timeout: 30,
    jitter_max: 300,
    sonarr_search_mode: "season" as "episode" | "season" | "series",
    search_upgrades: true,
    scan_interval_days: 7,
    timezone: "UTC",
    auto_start: false,
    dry_run: false,
  });

  const [discordForm, setDiscordForm] = useState({
    enabled: false,
    webhook_url: "",
    notify_missing: true,
    notify_upgrade: true,
    notify_cooldown: true,
    notify_limit: true,
    notify_offline: true,
  });

  useEffect(() => {
    if (!state) {
      return;
    }
    const saved = window.localStorage.getItem("mh-theme");
    if (!saved && state.config?.theme) {
      setTheme(state.config.theme);
    }
  }, [state, setTheme]);

  useEffect(() => {
    window.localStorage.setItem("mh-hour-mode", hourMode);
  }, [hourMode]);

  useEffect(() => {
    if (!editingInstanceId || !state) {
      return;
    }
    const inst = state.instances.find((item) => item.id === editingInstanceId);
    if (!inst) {
      setEditingInstanceId(null);
      return;
    }
    const parsedUrl = parseInstanceUrl(inst.url);
    setEditInstanceForm({
      type: inst.type,
      name: inst.name,
      protocol: parsedUrl.protocol,
      host: parsedUrl.host,
      port: parsedUrl.port,
      api_key: "",
      enabled: inst.enabled,
    });
  }, [editingInstanceId, state]);

  useEffect(() => {
    if (!state || settingsDirty) {
      return;
    }
    setSettingsForm({
      hunt_missing_delay: state.config.hunt_missing_delay,
      max_searches_per_run: state.config.max_searches_per_run,
      daily_limit: state.config.daily_limit,
      cooldown_days: state.config.cooldown_days,
      request_timeout: state.config.request_timeout,
      jitter_max: state.config.jitter_max,
      sonarr_search_mode: state.config.sonarr_search_mode,
      search_upgrades: state.config.search_upgrades,
      scan_interval_days: state.config.scan_interval_days,
      timezone: state.config.timezone,
      auto_start: state.config.auto_start,
      dry_run: state.config.dry_run,
    });
  }, [settingsDirty, state]);

  useEffect(() => {
    if (!state || discordDirty) {
      return;
    }
    const dc = state.config.discord ?? {};
    setDiscordForm({
      enabled: Boolean(dc.enabled),
      webhook_url: "",
      notify_missing: dc.notify_missing ?? true,
      notify_upgrade: dc.notify_upgrade ?? true,
      notify_cooldown: dc.notify_cooldown ?? true,
      notify_limit: dc.notify_limit ?? true,
      notify_offline: dc.notify_offline ?? true,
    });
    setDiscordWebhookTouched(false);
  }, [discordDirty, state]);

  const timezoneOptions = timezonesQuery.data?.timezones ?? [settingsForm.timezone];

  const addInstanceMutation = useMutation({
    mutationFn: api.addInstance,
    onSuccess: async () => {
      setInstanceMessage({ kind: "success", text: "Instance added" });
      setNewInstanceForm({ type: "sonarr", name: "", protocol: "http", host: "", port: defaultPortForType("sonarr"), api_key: "" });
      await queryClient.invalidateQueries({ queryKey: ["state"] });
    },
    onError: () => {
      setInstanceMessage({ kind: "error", text: "Failed to add instance" });
    },
  });

  const saveDiscordMutation = useMutation({
    mutationFn: () => {
      const payload: {
        enabled: boolean;
        notify_missing: boolean;
        notify_upgrade: boolean;
        notify_cooldown: boolean;
        notify_limit: boolean;
        notify_offline: boolean;
        webhook_url?: string;
      } = {
        enabled: discordForm.enabled,
        notify_missing: discordForm.notify_missing,
        notify_upgrade: discordForm.notify_upgrade,
        notify_cooldown: discordForm.notify_cooldown,
        notify_limit: discordForm.notify_limit,
        notify_offline: discordForm.notify_offline,
      };

      if (discordWebhookTouched) {
        payload.webhook_url = discordForm.webhook_url.trim();
      }
      return api.updateDiscordConfig(payload);
    },
    onSuccess: async (data) => {
      if (!data.ok) {
        setDiscordMessage({ kind: "error", text: data.error || "Failed to save Discord settings" });
        return;
      }
      setDiscordMessage({ kind: "success", text: "Discord settings saved" });
      setDiscordDirty(false);
      setDiscordWebhookTouched(false);
      await queryClient.invalidateQueries({ queryKey: ["state"] });
    },
    onError: () => {
      setDiscordMessage({ kind: "error", text: "Failed to save Discord settings" });
    },
  });

  const testDiscordMutation = useMutation({
    mutationFn: api.testDiscord,
    onSuccess: (data) => {
      if (!data.ok) {
        setDiscordMessage({ kind: "error", text: data.error || "Discord test failed" });
        return;
      }
      setDiscordMessage({ kind: "success", text: "Discord test notification sent" });
    },
    onError: () => {
      setDiscordMessage({ kind: "error", text: "Discord test failed" });
    },
  });

  const updateInstanceMutation = useMutation({
    mutationFn: ({ instanceId, payload }: { instanceId: string; payload: Parameters<typeof api.updateInstance>[1] }) => api.updateInstance(instanceId, payload),
    onSuccess: async () => {
      setInstanceMessage({ kind: "success", text: "Instance updated" });
      setEditingInstanceId(null);
      await queryClient.invalidateQueries({ queryKey: ["state"] });
    },
    onError: () => {
      setInstanceMessage({ kind: "error", text: "Failed to update instance" });
    },
  });

  const deleteInstanceMutation = useMutation({
    mutationFn: api.deleteInstance,
    onSuccess: async () => {
      setInstanceMessage({ kind: "success", text: "Instance deleted" });
      setEditingInstanceId(null);
      await queryClient.invalidateQueries({ queryKey: ["state"] });
    },
    onError: () => {
      setInstanceMessage({ kind: "error", text: "Failed to delete instance" });
    },
  });

  const pingInstanceMutation = useMutation({
    mutationFn: api.pingInstance,
    onSuccess: async (data) => {
      const copy = data.ok ? `Ping OK${data.version ? ` (${data.version})` : ""}` : `Ping failed${data.msg ? `: ${data.msg}` : ""}`;
      setInstanceMessage({ kind: data.ok ? "success" : "error", text: copy });
      await queryClient.invalidateQueries({ queryKey: ["state"] });
    },
    onError: () => {
      setInstanceMessage({ kind: "error", text: "Ping failed" });
    },
  });

  const clearHistoryMutation = useMutation({
    mutationFn: api.clearHistory,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["history"] });
      await queryClient.invalidateQueries({ queryKey: ["history-stats"] });
      await queryClient.invalidateQueries({ queryKey: ["state"] });
    },
  });

  const clearHistoryByInstanceMutation = useMutation({
    mutationFn: api.clearHistoryForInstance,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["history"] });
      await queryClient.invalidateQueries({ queryKey: ["history-stats"] });
      await queryClient.invalidateQueries({ queryKey: ["state"] });
    },
  });

  if (stateQuery.isLoading) {
    return (
      <main className="page">
        <h1>MediaHunter Dashboard (React)</h1>
        <p>Loading live runtime state...</p>
      </main>
    );
  }

  if (authQuery.isLoading) {
    return (
      <main className="page">
        <h1>MediaHunter Dashboard (React)</h1>
        <p>Checking session...</p>
      </main>
    );
  }

  if (authQuery.data?.auth_enabled && !authQuery.data.authenticated) {
    return (
      <main className="page">
        <h1>MediaHunter Dashboard (React)</h1>
        <p>Redirecting to login...</p>
      </main>
    );
  }

  if (authQuery.data && !authQuery.data.setup_complete) {
    return (
      <main className="page">
        <h1>MediaHunter Dashboard (React)</h1>
        <p>Redirecting to setup...</p>
      </main>
    );
  }

  if (stateQuery.isError || !state) {
    return (
      <main className="page">
        <h1>MediaHunter Dashboard (React)</h1>
        <p className="mh-error">Failed to load dashboard state from /api/state.</p>
      </main>
    );
  }

  const activeInstances = state.instances.filter((i) => i.enabled).length;

  const runControl = (action: "start" | "stop" | "run_now") => {
    controlMutation.mutate(action);
  };

  const onSettingsSubmit = (event: FormEvent) => {
    event.preventDefault();
    saveConfigMutation.mutate({
      ...settingsForm,
      hunt_missing_delay: Number(settingsForm.hunt_missing_delay),
      max_searches_per_run: Number(settingsForm.max_searches_per_run),
      daily_limit: Number(settingsForm.daily_limit),
      cooldown_days: Number(settingsForm.cooldown_days),
      request_timeout: Number(settingsForm.request_timeout),
      jitter_max: Number(settingsForm.jitter_max),
      scan_interval_days: Number(settingsForm.scan_interval_days),
    });
  };

  const updateSettingsField = <K extends keyof typeof settingsForm>(key: K, value: (typeof settingsForm)[K]) => {
    setSettingsDirty(true);
    setSettingsForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const onAddInstanceSubmit = (event: FormEvent) => {
    event.preventDefault();
    setInstanceMessage(null);
    addInstanceMutation.mutate({
      type: newInstanceForm.type,
      name: newInstanceForm.name,
      url: buildInstanceUrl(newInstanceForm.protocol, newInstanceForm.host, newInstanceForm.port),
      api_key: newInstanceForm.api_key,
    });
  };

  const updateDiscordField = <K extends keyof typeof discordForm>(key: K, value: (typeof discordForm)[K]) => {
    setDiscordDirty(true);
    if (key === "webhook_url") {
      setDiscordWebhookTouched(true);
    }
    setDiscordForm((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const onSaveInstanceEdit = (instanceId: string) => {
    setInstanceMessage(null);
    updateInstanceMutation.mutate({
      instanceId,
      payload: {
        type: editInstanceForm.type,
        name: editInstanceForm.name,
        url: buildInstanceUrl(editInstanceForm.protocol, editInstanceForm.host, editInstanceForm.port),
        api_key: editInstanceForm.api_key || undefined,
        enabled: editInstanceForm.enabled,
      },
    });
  };

  const onDeleteInstance = (instanceId: string, name: string) => {
    if (!window.confirm(`Delete instance ${name}?`)) {
      return;
    }
    setInstanceMessage(null);
    deleteInstanceMutation.mutate(instanceId);
  };

  return (
    <main className="mh-shell">
      <div className="mh-layout">
        <aside className="mh-sidebar">
          <div className="mh-logo-wrap">
            <div className="mh-logo-name">media<span>hunter</span></div>
            <div className="mh-logo-sub">React migration view</div>
          </div>

          <nav className="mh-nav">
            <button type="button" className={`mh-nav-item ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>Dashboard</button>
            <button type="button" className={`mh-nav-item ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>Settings</button>
            <button type="button" className={`mh-nav-item ${activeTab === "instances" ? "active" : ""}`} onClick={() => setActiveTab("instances")}>Instances</button>
            <button type="button" className={`mh-nav-item ${activeTab === "history" ? "active" : ""}`} onClick={() => setActiveTab("history")}>History</button>
          </nav>
        </aside>

        <section className="mh-main">
          <header className="mh-topbar">
            <div>
              <h1>MediaHunter Dashboard</h1>
              <p className="mh-subtitle">Live API view with runtime controls</p>
            </div>
            <div className="mh-pills">
              {authQuery.data?.auth_enabled && (
                <div className="mh-auth-pill">Authenticated</div>
              )}
              {!authQuery.data?.auth_enabled && (
                <div className="mh-auth-pill mh-auth-pill-open">Auth Off</div>
              )}
              {authQuery.data?.auth_enabled && (
                <button
                  type="button"
                  className="mh-logout-btn"
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                >
                  Logout
                </button>
              )}
              <div className="mh-runtime-pill">
                <span className={`mh-dot ${state.running ? "running" : "stopped"}`} />
                {state.running ? "Running" : "Stopped"}
              </div>
              {state.config.dry_run && <div className="mh-dry-pill">Dry Run</div>}
            </div>
          </header>

          <section className="mh-control-bar">
            <div className="mh-controls-row">
              <button type="button" onClick={() => runControl("start")} disabled={controlMutation.isPending}>Start</button>
              <button type="button" onClick={() => runControl("stop")} disabled={controlMutation.isPending}>Stop</button>
              <button type="button" onClick={() => runControl("run_now")} disabled={controlMutation.isPending}>Run Now</button>
            </div>
            <p className="mh-meta">Last Run: {formatDisplayTime(state.last_run, hourMode)} | Next Run: {formatDisplayTime(state.next_run, hourMode)} | Server: {formatDisplayTime(state.server_time, hourMode)} ({state.server_tz})</p>
          </section>

          {activeTab === "dashboard" && (
            <section className="mh-content-split">
              <div className="mh-left-col">
                <section className="mh-grid mh-grid-4">
                  <article className="mh-card mh-stat">
                    <h3>Today</h3>
                    <p>{state.daily_count} / {state.daily_limit || "∞"}</p>
                  </article>
                  <article className="mh-card mh-stat">
                    <h3>Total Searches</h3>
                    <p>{state.total_searches}</p>
                  </article>
                  <article className="mh-card mh-stat">
                    <h3>Cycle Count</h3>
                    <p>{state.cycle_count}</p>
                  </article>
                  <article className="mh-card mh-stat">
                    <h3>Active Instances</h3>
                    <p>{activeInstances} / {state.config.instance_count}</p>
                  </article>
                </section>

                <article className="mh-card">
                  <h2>Instances</h2>
                  <div className="mh-list">
                    {state.instances.map((inst) => {
                      const stats = state.inst_stats[inst.id];
                      const status = stats?.status ?? "unknown";
                      return (
                        <div className="mh-list-row" key={inst.id}>
                          <div>
                            <strong>{inst.name}</strong>
                            <p className="mh-small">{inst.type} | {stats?.version ?? "?"}</p>
                          </div>
                          <div className="mh-right">
                            <span className={`mh-badge ${status}`}>{status}</span>
                            <p className="mh-small">Queue: {stats?.queue_size ?? 0}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              </div>

              <aside className="mh-right-rail">
                <article className="mh-card mh-log-card">
                  <h2>Recent Activity</h2>
                  <div className="mh-log-list">
                    {state.activity_log.length === 0 ? (
                      <p className="mh-small">No activity yet.</p>
                    ) : (
                      state.activity_log.slice(0, 20).map((entry, idx) => (
                        <div className="mh-log-row" key={`${entry.ts}-${entry.service}-${idx}`}>
                          <div className="mh-log-top">
                            <span className="mh-log-ts">{entry.ts}</span>
                            <span className={`mh-badge ${entry.status}`}>{entry.status}</span>
                          </div>
                          <div className="mh-log-title">{entry.action}</div>
                          <div className="mh-small">{formatDisplayTime(entry.ts, hourMode)} | {entry.item || "-"}</div>
                        </div>
                      ))
                    )}
                  </div>
                </article>
              </aside>
            </section>
          )}

          {activeTab === "settings" && (
            <section className="mh-content-single">
              <div className="mh-instance-stack">
                <article className="mh-card">
                  <h2>Runtime Settings</h2>
                  <form className="mh-settings-grid" onSubmit={onSettingsSubmit}>
                    <label>
                      Missing Interval (sec)
                      <input type="number" min={900} value={settingsForm.hunt_missing_delay} onChange={(e) => updateSettingsField("hunt_missing_delay", Number(e.target.value))} />
                    </label>
                    <label>
                      Max Searches / Run
                      <input type="number" min={1} max={500} value={settingsForm.max_searches_per_run} onChange={(e) => updateSettingsField("max_searches_per_run", Number(e.target.value))} />
                    </label>
                    <label>
                      Daily Limit (0 = unlimited)
                      <input type="number" min={0} max={9999} value={settingsForm.daily_limit} onChange={(e) => updateSettingsField("daily_limit", Number(e.target.value))} />
                    </label>
                    <label>
                      Cooldown Days
                      <input type="number" min={1} max={365} value={settingsForm.cooldown_days} onChange={(e) => updateSettingsField("cooldown_days", Number(e.target.value))} />
                    </label>
                    <label>
                      Request Timeout (sec)
                      <input type="number" min={5} max={300} value={settingsForm.request_timeout} onChange={(e) => updateSettingsField("request_timeout", Number(e.target.value))} />
                    </label>
                    <label>
                      Jitter Max (sec)
                      <input type="number" min={0} max={3600} value={settingsForm.jitter_max} onChange={(e) => updateSettingsField("jitter_max", Number(e.target.value))} />
                    </label>
                    <label>
                      Scan Interval (days)
                      <input type="number" min={1} max={365} value={settingsForm.scan_interval_days} onChange={(e) => updateSettingsField("scan_interval_days", Number(e.target.value))} />
                    </label>
                    <label>
                      Sonarr Search Mode
                      <select value={settingsForm.sonarr_search_mode} onChange={(e) => updateSettingsField("sonarr_search_mode", e.target.value as "episode" | "season" | "series") }>
                        <option value="episode">Episode</option>
                        <option value="season">Season</option>
                        <option value="series">Series</option>
                      </select>
                    </label>
                    <label className="mh-settings-full">
                      Timezone
                      <select value={settingsForm.timezone} onChange={(e) => updateSettingsField("timezone", e.target.value)}>
                        {timezoneOptions.map((tz) => (
                          <option key={tz} value={tz}>{tz}</option>
                        ))}
                      </select>
                    </label>

                    <label className="mh-toggle">
                      <input type="checkbox" checked={settingsForm.search_upgrades} onChange={(e) => updateSettingsField("search_upgrades", e.target.checked)} />
                      Search Upgrades
                    </label>
                    <label className="mh-toggle">
                      <input type="checkbox" checked={settingsForm.auto_start} onChange={(e) => updateSettingsField("auto_start", e.target.checked)} />
                      Auto Start on Boot
                    </label>
                    <label className="mh-toggle">
                      <input type="checkbox" checked={settingsForm.dry_run} onChange={(e) => updateSettingsField("dry_run", e.target.checked)} />
                      Dry Run (no actual requests)
                    </label>

                    <div className="mh-settings-actions mh-settings-full">
                      <button type="submit" disabled={saveConfigMutation.isPending}>Save Settings</button>
                      {settingsDirty && !saveConfigMutation.isPending && <span className="mh-save-pending">Unsaved changes</span>}
                      {saveConfigMutation.isSuccess && <span className="mh-save-ok">Saved</span>}
                      {saveConfigMutation.isError && <span className="mh-error">Save failed</span>}
                    </div>
                  </form>
                </article>

                <article className="mh-card">
                  <h2>Display Preferences</h2>
                  <div className="mh-settings-grid">
                    <label className="mh-settings-full">
                      Time Display
                      <div className="mh-choice-row">
                        <button type="button" className={`mh-choice-btn ${hourMode === "24" ? "active" : ""}`} onClick={() => setHourMode("24")}>24-hour</button>
                        <button type="button" className={`mh-choice-btn ${hourMode === "12" ? "active" : ""}`} onClick={() => setHourMode("12")}>12-hour</button>
                      </div>
                    </label>
                    <div className="mh-settings-full">
                      <div className="mh-theme-label">Theme</div>
                      <div className="theme-grid">
                        {THEMES.map((t) => (
                          <button
                            key={t.key}
                            className={`theme-btn ${t.className} ${theme === t.key ? "active" : ""}`}
                            id={`theme-${t.key}`}
                            type="button"
                            onClick={() => setTheme(t.key)}
                            title={t.title}
                          >
                            <div className="theme-btn-head">
                              <div className="theme-btn-copy"><strong>{t.title}</strong><span>{t.subtitle}</span></div>
                              <div className="theme-swatches" aria-hidden="true"><span className="theme-swatch bg" /><span className="theme-swatch surface" /><span className="theme-swatch accent" /><span className="theme-swatch support" /></div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="mh-small mh-settings-full">This preference is local to your browser and applies immediately.</p>
                  </div>
                </article>

                <article className="mh-card">
                  <h2>Discord Notifications</h2>
                  <div className="mh-settings-grid">
                    <label className="mh-settings-full">
                      Webhook URL
                      <input
                        type="password"
                        placeholder={state.config.discord_configured ? "Configured (leave empty to keep)" : "https://discord.com/api/webhooks/..."}
                        value={discordForm.webhook_url}
                        onChange={(e) => updateDiscordField("webhook_url", e.target.value)}
                      />
                    </label>

                    <label className="mh-toggle">
                      <input type="checkbox" checked={discordForm.enabled} onChange={(e) => updateDiscordField("enabled", e.target.checked)} />
                      Enabled
                    </label>
                    <label className="mh-toggle">
                      <input type="checkbox" checked={discordForm.notify_missing} onChange={(e) => updateDiscordField("notify_missing", e.target.checked)} />
                      Missing searched
                    </label>
                    <label className="mh-toggle">
                      <input type="checkbox" checked={discordForm.notify_upgrade} onChange={(e) => updateDiscordField("notify_upgrade", e.target.checked)} />
                      Upgrade searched
                    </label>
                    <label className="mh-toggle">
                      <input type="checkbox" checked={discordForm.notify_cooldown} onChange={(e) => updateDiscordField("notify_cooldown", e.target.checked)} />
                      Cooldown notifications
                    </label>
                    <label className="mh-toggle">
                      <input type="checkbox" checked={discordForm.notify_limit} onChange={(e) => updateDiscordField("notify_limit", e.target.checked)} />
                      Daily limit reached
                    </label>
                    <label className="mh-toggle">
                      <input type="checkbox" checked={discordForm.notify_offline} onChange={(e) => updateDiscordField("notify_offline", e.target.checked)} />
                      Instance offline
                    </label>

                    <div className="mh-settings-actions mh-settings-full">
                      <button type="button" onClick={() => saveDiscordMutation.mutate()} disabled={saveDiscordMutation.isPending}>Save Discord</button>
                      <button type="button" onClick={() => testDiscordMutation.mutate()} disabled={testDiscordMutation.isPending}>Send Test</button>
                      <button type="button" onClick={() => updateDiscordField("webhook_url", "")} disabled={saveDiscordMutation.isPending}>Clear URL</button>
                      {discordDirty && !saveDiscordMutation.isPending && <span className="mh-save-pending">Unsaved changes</span>}
                      {discordMessage && <span className={discordMessage.kind === "error" ? "mh-error" : discordMessage.kind === "success" ? "mh-save-ok" : "mh-small"}>{discordMessage.text}</span>}
                    </div>
                    <p className="mh-small mh-settings-full">Webhook currently {state.config.discord_configured ? "configured" : "not configured"}.</p>
                  </div>
                </article>
              </div>
            </section>
          )}

          {activeTab === "instances" && (
            <section className="mh-content-single">
              <div className="mh-instance-stack">
                <article className="mh-card">
                  <h2>Add Instance</h2>
                  <form className="mh-settings-grid" onSubmit={onAddInstanceSubmit}>
                    <div className="mh-instance-form-grid mh-settings-full">
                      <label>
                        Type
                        <select value={newInstanceForm.type} onChange={(e) => {
                          const nextType = e.target.value as "sonarr" | "radarr";
                          setNewInstanceForm((current) => {
                            const nextDefaultPort = defaultPortForType(nextType);
                            const currentDefaultPort = defaultPortForType(current.type);
                            return {
                              ...current,
                              type: nextType,
                              port: current.port === "" || current.port === currentDefaultPort ? nextDefaultPort : current.port,
                            };
                          });
                        }}>
                          <option value="sonarr">Sonarr</option>
                          <option value="radarr">Radarr</option>
                        </select>
                      </label>
                      <label>
                        Name
                        <input type="text" value={newInstanceForm.name} onChange={(e) => setNewInstanceForm((current) => ({ ...current, name: e.target.value }))} />
                      </label>
                    </div>
                    <div className="mh-instance-form-grid-3 mh-settings-full">
                      <label>
                        Protocol
                        <select value={newInstanceForm.protocol} onChange={(e) => setNewInstanceForm((current) => ({ ...current, protocol: e.target.value as "http" | "https" }))}>
                          <option value="http">http://</option>
                          <option value="https">https://</option>
                        </select>
                      </label>
                      <label>
                        Host / IP
                        <input type="text" value={newInstanceForm.host} onChange={(e) => setNewInstanceForm((current) => ({ ...current, host: e.target.value }))} />
                      </label>
                      <label>
                        Port
                        <input type="number" min={1} max={65535} value={newInstanceForm.port} onChange={(e) => setNewInstanceForm((current) => ({ ...current, port: e.target.value }))} />
                      </label>
                    </div>
                    <label className="mh-settings-full">
                      API Key
                      <input type="text" value={newInstanceForm.api_key} onChange={(e) => setNewInstanceForm((current) => ({ ...current, api_key: e.target.value }))} />
                    </label>
                    <div className="mh-settings-actions mh-settings-full">
                      <button type="submit" disabled={addInstanceMutation.isPending}>Add Instance</button>
                    </div>
                  </form>
                </article>

                <article className="mh-card">
                  <h2>Manage Instances</h2>
                  {instanceMessage && <p className={instanceMessage.kind === "error" ? "mh-error" : instanceMessage.kind === "success" ? "mh-save-ok" : "mh-small"}>{instanceMessage.text}</p>}
                  <div className="mh-list">
                    {state.instances.map((inst) => {
                      const stats = state.inst_stats[inst.id];
                      const isEditing = editingInstanceId === inst.id;
                      return (
                        <div className="mh-instance-card" key={inst.id}>
                          {isEditing ? (
                            <div className="mh-settings-grid">
                              <div className="mh-instance-form-grid mh-settings-full">
                                <label>
                                  Type
                                  <select value={editInstanceForm.type} onChange={(e) => {
                                    const nextType = e.target.value as "sonarr" | "radarr";
                                    setEditInstanceForm((current) => {
                                      const nextDefaultPort = defaultPortForType(nextType);
                                      const currentDefaultPort = defaultPortForType(current.type);
                                      return {
                                        ...current,
                                        type: nextType,
                                        port: current.port === "" || current.port === currentDefaultPort ? nextDefaultPort : current.port,
                                      };
                                    });
                                  }}>
                                    <option value="sonarr">Sonarr</option>
                                    <option value="radarr">Radarr</option>
                                  </select>
                                </label>
                                <label>
                                  Name
                                  <input type="text" value={editInstanceForm.name} onChange={(e) => setEditInstanceForm((current) => ({ ...current, name: e.target.value }))} />
                                </label>
                              </div>
                              <div className="mh-instance-form-grid-3 mh-settings-full">
                                <label>
                                  Protocol
                                  <select value={editInstanceForm.protocol} onChange={(e) => setEditInstanceForm((current) => ({ ...current, protocol: e.target.value as "http" | "https" }))}>
                                    <option value="http">http://</option>
                                    <option value="https">https://</option>
                                  </select>
                                </label>
                                <label>
                                  Host / IP
                                  <input type="text" value={editInstanceForm.host} onChange={(e) => setEditInstanceForm((current) => ({ ...current, host: e.target.value }))} />
                                </label>
                                <label>
                                  Port
                                  <input type="number" min={1} max={65535} value={editInstanceForm.port} onChange={(e) => setEditInstanceForm((current) => ({ ...current, port: e.target.value }))} />
                                </label>
                              </div>
                              <label className="mh-settings-full">
                                API Key (leave blank to keep current)
                                <input type="text" value={editInstanceForm.api_key} onChange={(e) => setEditInstanceForm((current) => ({ ...current, api_key: e.target.value }))} />
                              </label>
                              <label className="mh-toggle mh-settings-full">
                                <input type="checkbox" checked={editInstanceForm.enabled} onChange={(e) => setEditInstanceForm((current) => ({ ...current, enabled: e.target.checked }))} />
                                Enabled
                              </label>
                              <div className="mh-settings-actions mh-settings-full">
                                <button type="button" onClick={() => onSaveInstanceEdit(inst.id)} disabled={updateInstanceMutation.isPending}>Save</button>
                                <button type="button" onClick={() => setEditingInstanceId(null)}>Cancel</button>
                                <button type="button" onClick={() => pingInstanceMutation.mutate(inst.id)} disabled={pingInstanceMutation.isPending}>Ping</button>
                                <button type="button" onClick={() => onDeleteInstance(inst.id, inst.name)} disabled={deleteInstanceMutation.isPending}>Delete</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="mh-instance-head">
                                <div>
                                  <strong>{inst.name}</strong>
                                  <p className="mh-small">{inst.type} | {inst.url}</p>
                                </div>
                                <div className="mh-right">
                                  <span className={`mh-badge ${stats?.status ?? "unknown"}`}>{stats?.status ?? "unknown"}</span>
                                  <p className="mh-small">{stats?.version ?? "?"}</p>
                                </div>
                              </div>
                              <div className="mh-instance-actions">
                                <button type="button" onClick={() => setEditingInstanceId(inst.id)}>Edit</button>
                                <button type="button" onClick={() => pingInstanceMutation.mutate(inst.id)} disabled={pingInstanceMutation.isPending}>Ping</button>
                                <button type="button" onClick={() => updateInstanceMutation.mutate({ instanceId: inst.id, payload: { enabled: !inst.enabled } })} disabled={updateInstanceMutation.isPending}>{inst.enabled ? "Disable" : "Enable"}</button>
                                <button type="button" onClick={() => onDeleteInstance(inst.id, inst.name)} disabled={deleteInstanceMutation.isPending}>Delete</button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </article>
              </div>
            </section>
          )}

          {activeTab === "history" && (
            <section className="mh-content-single">
              <div className="mh-instance-stack">
                <article className="mh-card">
                  <h2>History Overview</h2>
                  <div className="mh-grid mh-grid-4">
                    <article className="mh-card mh-stat">
                      <h3>Total Entries</h3>
                      <p>{historyStatsQuery.data?.total ?? "-"}</p>
                    </article>
                    <article className="mh-card mh-stat">
                      <h3>Today</h3>
                      <p>{historyStatsQuery.data?.today ?? "-"}</p>
                    </article>
                    <article className="mh-card mh-stat">
                      <h3>Services Tracked</h3>
                      <p>{historyStatsQuery.data ? Object.keys(historyStatsQuery.data.by_service || {}).length : "-"}</p>
                    </article>
                    <article className="mh-card mh-stat">
                      <h3>Rows Loaded</h3>
                      <p>{historyQuery.data?.count ?? "-"}</p>
                    </article>
                  </div>
                </article>

                <article className="mh-card">
                  <h2>History Filters</h2>
                  <div className="mh-history-toolbar">
                    <label>
                      Instance
                      <select value={historyService} onChange={(e) => setHistoryService(e.target.value)}>
                        <option value="all">All instances</option>
                        {state.instances.map((inst) => (
                          <option key={inst.id} value={inst.id}>{inst.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="mh-toggle">
                      <input type="checkbox" checked={historyCooldownOnly} onChange={(e) => setHistoryCooldownOnly(e.target.checked)} />
                      Cooldown only
                    </label>
                    <button type="button" onClick={() => historyQuery.refetch()} disabled={historyQuery.isFetching}>Refresh</button>
                    <button type="button" onClick={() => clearHistoryMutation.mutate()} disabled={clearHistoryMutation.isPending}>Clear All</button>
                    {historyService !== "all" && (
                      <button type="button" onClick={() => clearHistoryByInstanceMutation.mutate(historyService)} disabled={clearHistoryByInstanceMutation.isPending}>Clear Selected Instance</button>
                    )}
                  </div>
                </article>

                <article className="mh-card">
                  <h2>History Entries</h2>
                  {historyQuery.isLoading && <p className="mh-small">Loading history...</p>}
                  {historyQuery.isError && <p className="mh-error">Failed to load history.</p>}
                  {!historyQuery.isLoading && !historyQuery.isError && (
                    <div className="mh-history-list">
                      {historyQuery.data && historyQuery.data.history.length > 0 ? (
                        historyQuery.data.history.slice(0, 150).map((entry) => (
                          <div className="mh-history-row" key={entry.id}>
                            <div className="mh-history-main">
                              <strong>{entry.title || "(untitled)"}</strong>
                              <p className="mh-small">{entry.instance_name || entry.service} | {entry.item_type} | result: {entry.result}</p>
                            </div>
                            <div className="mh-right">
                              <span className="mh-badge info">x{entry.search_count}</span>
                              <p className="mh-small">{entry.ago_label || formatDisplayTime(entry.searched_at, hourMode)}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="mh-small">No history entries found for current filter.</p>
                      )}
                    </div>
                  )}
                </article>
              </div>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
