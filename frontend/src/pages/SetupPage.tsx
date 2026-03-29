import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useTheme } from "../app/providers/ThemeProvider";

const THEMES = [
  { key: "system", title: "System", subtitle: "Follows OS light/dark", className: "theme-system" },
  { key: "github-inspired", title: "GitHub", subtitle: "Neutral dev palette", className: "theme-github-inspired" },
  { key: "discord-inspired", title: "Discord", subtitle: "Violet social palette", className: "theme-discord-inspired" },
  { key: "plex-inspired", title: "Plex", subtitle: "Warm cinema palette", className: "theme-plex-inspired" },
] as const;

type SetupInstanceForm = {
  id: string;
  type: "sonarr" | "radarr";
  name: string;
  protocol: "http" | "https";
  host: string;
  port: string;
  api_key: string;
  testing: boolean;
  testResult: string;
  testOk: boolean;
  saved: boolean;
};

function defaultPort(type: "sonarr" | "radarr") {
  return type === "sonarr" ? "8989" : "7878";
}

function defaultHost() {
  const host = window.location.hostname || "127.0.0.1";
  return host === "localhost" ? "127.0.0.1" : host;
}

function buildUrl(inst: SetupInstanceForm) {
  const host = inst.host.trim();
  return `${inst.protocol}://${host}${inst.port.trim() ? `:${inst.port.trim()}` : ""}`;
}

export function SetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [errors, setErrors] = useState<string[]>([]);
  const [authUsername, setAuthUsername] = useState("admin");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("");
  const [discordWebhook, setDiscordWebhook] = useState("");
  const [discordTesting, setDiscordTesting] = useState(false);
  const [discordTestResult, setDiscordTestResult] = useState("");
  const [discordTestOk, setDiscordTestOk] = useState(false);
  const [discordSaved, setDiscordSaved] = useState(false);
  const [notifyMissing, setNotifyMissing] = useState(true);
  const [notifyUpgrade, setNotifyUpgrade] = useState(true);
  const [notifyCooldown, setNotifyCooldown] = useState(true);
  const [notifyLimit, setNotifyLimit] = useState(true);
  const [notifyOffline, setNotifyOffline] = useState(true);
  const [instances, setInstances] = useState<SetupInstanceForm[]>([
    {
      id: "new-1",
      type: "sonarr",
      name: "Sonarr",
      protocol: "http",
      host: defaultHost(),
      port: defaultPort("sonarr"),
      api_key: "",
      testing: false,
      testResult: "",
      testOk: false,
      saved: false,
    },
  ]);

  const authQuery = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => api.getAuthStatus(),
    retry: false,
  });

  useEffect(() => {
    if (authQuery.data?.auth_username) {
      setAuthUsername(authQuery.data.auth_username);
    }
  }, [authQuery.data]);

  useEffect(() => {
    if (!authQuery.data) {
      return;
    }
    if (authQuery.data.auth_enabled && !authQuery.data.authenticated) {
      navigate("/login?next=%2Fsetup", { replace: true });
      return;
    }
    if (authQuery.data.setup_complete) {
      navigate("/", { replace: true });
    }
  }, [authQuery.data, navigate]);

  const completeMutation = useMutation({
    mutationFn: () =>
      api.completeSetup({
        instances: instances.map((inst) => ({
          id: inst.id,
          type: inst.type,
          name: inst.name.trim(),
          url: buildUrl(inst),
          api_key: inst.api_key.trim(),
        })),
        theme,
        auth: authQuery.data?.env_password_locked
          ? undefined
          : {
              username: authUsername.trim(),
              password: authPassword,
            },
        discord: discordWebhook.trim()
          ? {
              webhook_url: discordWebhook.trim(),
              notify_missing: notifyMissing,
              notify_upgrade: notifyUpgrade,
              notify_cooldown: notifyCooldown,
              notify_limit: notifyLimit,
              notify_offline: notifyOffline,
            }
          : undefined,
      }),
    onSuccess: (data) => {
      if (!data.ok) {
        setErrors(data.errors || [data.error || "Setup failed"]);
        return;
      }
      queryClient.setQueryData(["auth-status"], (current: { auth_enabled?: boolean; authenticated?: boolean; setup_complete?: boolean; theme?: string; auth_username?: string } | undefined) => ({
        ...current,
        auth_enabled: authQuery.data?.env_password_locked ? (current?.auth_enabled ?? true) : true,
        authenticated: current?.authenticated ?? true,
        setup_complete: true,
        theme,
        auth_username: authUsername.trim() || "admin",
      }));
      setErrors([]);
      navigate("/", { replace: true });
    },
    onError: () => {
      setErrors(["Setup failed. Please review your values and try again."]);
    },
  });

  const nextId = useMemo(() => instances.length + 1, [instances.length]);

  const addInstance = () => {
    setInstances((current) => [
      ...current,
      {
        id: `new-${nextId}`,
        type: "sonarr",
        name: `Sonarr ${nextId}`,
        protocol: "http",
        host: defaultHost(),
        port: defaultPort("sonarr"),
        api_key: "",
        testing: false,
        testResult: "",
        testOk: false,
        saved: false,
      },
    ]);
  };

  const removeInstance = (instanceId: string) => {
    setInstances((current) => current.filter((inst) => inst.id !== instanceId));
  };

  const updateInstance = (instanceId: string, patch: Partial<SetupInstanceForm>) => {
    setInstances((current) =>
      current.map((inst) => {
        if (inst.id !== instanceId) {
          return inst;
        }
        const merged = { ...inst, ...patch, testResult: patch.testResult ?? "" };
        if (patch.type && patch.type !== inst.type) {
          const currentDefault = defaultPort(inst.type);
          if (!inst.port || inst.port === currentDefault) {
            merged.port = defaultPort(patch.type);
          }
          if (inst.name === "Sonarr" || inst.name === "Radarr" || inst.name.startsWith("Sonarr ") || inst.name.startsWith("Radarr ")) {
            merged.name = patch.type === "sonarr" ? "Sonarr" : "Radarr";
          }
        }
        if (patch.type || patch.name || patch.protocol || patch.host || patch.port || patch.api_key) {
          merged.testOk = false;
          merged.saved = false;
        }
        return merged;
      }),
    );
  };

  const testInstance = async (instanceId: string) => {
    const target = instances.find((inst) => inst.id === instanceId);
    if (!target) {
      return;
    }
    updateInstance(instanceId, { testing: true, testResult: "Testing..." });
    try {
      const data = await api.setupPing({
        type: target.type,
        url: buildUrl(target),
        api_key: target.api_key.trim(),
      });
      updateInstance(instanceId, {
        testing: false,
        testOk: Boolean(data.ok),
        testResult: data.ok ? `Connected${data.version ? ` (${data.version})` : ""}` : `Failed: ${data.msg || "Connection error"}`,
      });
    } catch {
      updateInstance(instanceId, { testing: false, testOk: false, testResult: "Failed: connection error" });
    }
  };

  const validateInstances = () => {
    setErrors([]);

    if (instances.length === 0) {
      setErrors(["At least one instance is required."]);
      return false;
    }

    const localErrors: string[] = [];
    instances.forEach((inst, idx) => {
      if (!inst.name.trim()) {
        localErrors.push(`Instance ${idx + 1}: name is required.`);
      }
      if (!inst.host.trim()) {
        localErrors.push(`Instance ${idx + 1}: host is required.`);
      }
      if (!inst.api_key.trim()) {
        localErrors.push(`Instance ${idx + 1}: API key is required.`);
      }
      if (!inst.saved) {
        localErrors.push(`Instance ${idx + 1}: click Save after testing.`);
      }
    });

    if (localErrors.length > 0) {
      setErrors(localErrors);
      return false;
    }

    return true;
  };

  const validateAuthStep = () => {
    setErrors([]);
    if (authQuery.data?.env_password_locked) {
      return true;
    }
    const name = authUsername.trim();
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(name)) {
      setErrors(["Username must be 3-32 chars using letters, numbers, dot, underscore, or dash."]);
      return false;
    }
    if (authPassword.length < 8) {
      setErrors(["Password must be at least 8 characters."]);
      return false;
    }
    if (authPassword !== authPasswordConfirm) {
      setErrors(["Password confirmation does not match."]);
      return false;
    }
    return true;
  };

  const saveInstance = (instanceId: string) => {
    const target = instances.find((inst) => inst.id === instanceId);
    if (!target) {
      return;
    }
    const localErrors: string[] = [];
    if (!target.name.trim()) {
      localErrors.push("Instance name is required.");
    }
    if (!target.host.trim()) {
      localErrors.push("Instance host is required.");
    }
    if (!target.api_key.trim()) {
      localErrors.push("Instance API key is required.");
    }
    if (localErrors.length > 0) {
      updateInstance(instanceId, { saved: false, testResult: localErrors[0] });
      return;
    }
    if (!target.testOk) {
      updateInstance(instanceId, { saved: false, testResult: "Run a successful Test before Save." });
      return;
    }
    updateInstance(instanceId, { saved: true, testResult: "Saved" });
  };

  const testDiscordWebhook = async () => {
    const webhook = discordWebhook.trim();
    if (!webhook) {
      setDiscordTestResult("Webhook URL is required.");
      return;
    }
    setDiscordTesting(true);
    setDiscordTestResult("");
    try {
      const data = await api.testSetupDiscord(webhook);
      setDiscordTestOk(Boolean(data.ok));
      setDiscordTestResult(data.ok ? "Test successful!" : `Failed: ${data.error || "Unknown error"}`);
    } catch {
      setDiscordTestOk(false);
      setDiscordTestResult("Failed: connection error");
    } finally {
      setDiscordTesting(false);
    }
  };

  const saveDiscordWebhook = () => {
    const webhook = discordWebhook.trim();
    if (!webhook) {
      setDiscordSaved(false);
      setDiscordTestResult("Webhook URL is required.");
      return;
    }
    if (!discordTestOk) {
      setDiscordSaved(false);
      setDiscordTestResult("Run a successful Test before Save.");
      return;
    }
    setDiscordSaved(true);
    setDiscordTestResult("Saved");
  };

  const onFinishSetup = () => {
    if (!validateAuthStep()) {
      setStep(1);
      return;
    }
    if (!validateInstances()) {
      setStep(3);
      return;
    }
    if (discordWebhook.trim() && !discordSaved) {
      setErrors(["Discord webhook must be tested and saved before finishing."]);
      return;
    }
    completeMutation.mutate();
  };

  const stepTitle = useMemo(() => {
    if (step === 1) return "Step 1: Credentials";
    if (step === 2) return "Step 2: Theme";
    if (step === 3) return "Step 3: Instances";
    return "Step 4: Discord";
  }, [step]);

  return (
    <main className="mh-setup-shell">
      <section className="mh-setup-card">
        <header className="mh-setup-head">
          <h1>MediaHunter Setup</h1>
          <p>{stepTitle}</p>
        </header>

        <div className="mh-setup-steps" role="tablist" aria-label="Setup steps">
          <button type="button" className={`mh-step-pill ${step === 1 ? "active" : ""}`} onClick={() => setStep(1)}>1. Credentials</button>
          <button type="button" className={`mh-step-pill ${step === 2 ? "active" : ""}`} onClick={() => setStep(2)}>2. Theme</button>
          <button type="button" className={`mh-step-pill ${step === 3 ? "active" : ""}`} onClick={() => setStep(3)}>3. Instances</button>
          <button type="button" className={`mh-step-pill ${step === 4 ? "active" : ""}`} onClick={() => setStep(4)}>4. Discord</button>
        </div>

        <div className="mh-setup-form">
          {step === 1 && (
            <article className="mh-setup-discord">
              {authQuery.data?.env_password_locked ? (
                <p className="mh-small">Environment password mode is enabled, so setup credentials are locked by MEDIAHUNTER_PASSWORD.</p>
              ) : (
                <>
                  <label>
                    Username
                    <input type="text" value={authUsername} onChange={(event) => setAuthUsername(event.target.value)} />
                  </label>
                  <label>
                    Password
                    <input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />
                  </label>
                  <label>
                    Confirm Password
                    <input type="password" value={authPasswordConfirm} onChange={(event) => setAuthPasswordConfirm(event.target.value)} />
                  </label>
                </>
              )}
              <div className="mh-setup-row mh-setup-submit">
                <button
                  type="button"
                  onClick={() => {
                    if (validateAuthStep()) {
                      setStep(2);
                    }
                  }}
                >
                  Next: Theme
                </button>
              </div>
            </article>
          )}

          {step === 2 && (
            <article className="mh-setup-discord">
              <h2>Choose Theme</h2>
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
              <div className="mh-setup-row mh-setup-submit">
                <button type="button" onClick={() => setStep(1)}>Back</button>
                <button type="button" onClick={() => setStep(3)}>Next: Instances</button>
              </div>
            </article>
          )}

          {step === 3 && (
            <>
              <div className="mh-setup-row mh-setup-row-head">
                <h2>Instances</h2>
                <button type="button" onClick={addInstance}>+ Add instance</button>
              </div>

              <div className="mh-setup-list">
                {instances.map((inst) => (
                  <article className="mh-setup-instance" key={inst.id}>
                    <div className="mh-instance-form-grid">
                      <label>
                        Type
                        <select value={inst.type} onChange={(event) => updateInstance(inst.id, { type: event.target.value as "sonarr" | "radarr" })}>
                          <option value="sonarr">Sonarr</option>
                          <option value="radarr">Radarr</option>
                        </select>
                      </label>
                      <label>
                        Name
                        <input type="text" value={inst.name} onChange={(event) => updateInstance(inst.id, { name: event.target.value })} />
                      </label>
                    </div>

                    <div className="mh-instance-form-grid-3">
                      <label>
                        Protocol
                        <select value={inst.protocol} onChange={(event) => updateInstance(inst.id, { protocol: event.target.value as "http" | "https" })}>
                          <option value="http">http://</option>
                          <option value="https">https://</option>
                        </select>
                      </label>
                      <label>
                        Host / IP
                        <input type="text" value={inst.host} onChange={(event) => updateInstance(inst.id, { host: event.target.value })} />
                      </label>
                      <label>
                        Port
                        <input type="number" min={1} max={65535} value={inst.port} onChange={(event) => updateInstance(inst.id, { port: event.target.value })} />
                      </label>
                    </div>

                    <label>
                      API Key
                      <input type="password" value={inst.api_key} onChange={(event) => updateInstance(inst.id, { api_key: event.target.value })} />
                    </label>

                    <div className="mh-setup-row">
                      <button type="button" onClick={() => testInstance(inst.id)} disabled={inst.testing}>Test</button>
                      <button type="button" onClick={() => saveInstance(inst.id)} disabled={!inst.testOk}>Save</button>
                      <button type="button" onClick={() => removeInstance(inst.id)} disabled={instances.length <= 1}>Remove</button>
                      {inst.testResult && (
                        <span className={inst.testOk ? "mh-save-ok" : inst.testResult.startsWith("Failed") ? "mh-error" : "mh-small"}>
                          {inst.testResult}
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>

              <div className="mh-setup-row mh-setup-submit">
                <button type="button" onClick={() => setStep(2)}>Back</button>
                <button
                  type="button"
                  onClick={() => {
                    if (validateInstances()) {
                      setStep(4);
                    }
                  }}
                >
                  Next: Discord
                </button>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <article className="mh-setup-discord">
                <h2>Discord (Optional)</h2>
                <label>
                  Webhook URL
                  <input type="password" placeholder="https://discord.com/api/webhooks/..." value={discordWebhook} onChange={(event) => { setDiscordWebhook(event.target.value); setDiscordTestOk(false); setDiscordSaved(false); setDiscordTestResult(""); }} />
                </label>
                
                {discordWebhook.trim() && (
                  <div className="mh-setup-row">
                    <button type="button" onClick={testDiscordWebhook} disabled={discordTesting}>
                      {discordTesting ? "Testing..." : "Test Webhook"}
                    </button>
                    <button type="button" onClick={saveDiscordWebhook} disabled={!discordTestOk}>
                      Save
                    </button>
                    {discordTestResult && (
                      <span className={discordTestOk ? "mh-save-ok" : "mh-error"}>
                        {discordTestResult}
                      </span>
                    )}
                  </div>
                )}

                <div className="mh-setup-toggles">
                  <label className="mh-toggle"><input type="checkbox" checked={notifyMissing} onChange={(event) => setNotifyMissing(event.target.checked)} />Missing searched</label>
                  <label className="mh-toggle"><input type="checkbox" checked={notifyUpgrade} onChange={(event) => setNotifyUpgrade(event.target.checked)} />Upgrade searched</label>
                  <label className="mh-toggle"><input type="checkbox" checked={notifyCooldown} onChange={(event) => setNotifyCooldown(event.target.checked)} />Cooldown notifications</label>
                  <label className="mh-toggle"><input type="checkbox" checked={notifyLimit} onChange={(event) => setNotifyLimit(event.target.checked)} />Daily limit reached</label>
                  <label className="mh-toggle"><input type="checkbox" checked={notifyOffline} onChange={(event) => setNotifyOffline(event.target.checked)} />Instance offline</label>
                </div>
              </article>

              <div className="mh-setup-row mh-setup-submit">
                <button type="button" onClick={() => setStep(3)}>Back</button>
                <button type="button" onClick={onFinishSetup} disabled={completeMutation.isPending || authQuery.isLoading}>Finish Setup</button>
              </div>
            </>
          )}

          {errors.length > 0 && (
            <div className="mh-setup-errors">
              {errors.map((err) => (
                <p key={err} className="mh-error">{err}</p>
              ))}
            </div>
          )}

        </div>
      </section>
    </main>
  );
}
