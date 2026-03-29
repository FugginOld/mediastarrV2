import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useTheme } from "../app/providers/ThemeProvider";

const THEMES = [
  { key: "system", title: "System", subtitle: "Follows OS light/dark", className: "theme-system" },
  { key: "github-inspired", title: "GitHub", subtitle: "Neutral dev palette", className: "theme-github-inspired" },
  { key: "discord-inspired", title: "Discord", subtitle: "Violet social palette", className: "theme-discord-inspired" },
  { key: "plex-inspired", title: "Plex", subtitle: "Warm cinema palette", className: "theme-plex-inspired" },
] as const;

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { theme, setTheme } = useTheme();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const nextTarget = useMemo(() => {
    const raw = searchParams.get("next") || "/";
    return raw.startsWith("/") ? raw : "/";
  }, [searchParams]);

  const authQuery = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => api.getAuthStatus(),
    retry: false,
  });

  useEffect(() => {
    if (authQuery.data?.theme) {
      setTheme(authQuery.data.theme);
    }
    if (authQuery.data?.auth_username) {
      setUsername(authQuery.data.auth_username);
    }
  }, [authQuery.data, setTheme]);

  useEffect(() => {
    if (!authQuery.data) {
      return;
    }
    if (!authQuery.data.auth_enabled) {
      navigate(authQuery.data.setup_complete ? "/" : "/setup", { replace: true });
      return;
    }
    if (authQuery.data.authenticated) {
      navigate(authQuery.data.setup_complete ? nextTarget : "/setup", { replace: true });
    }
  }, [authQuery.data, navigate, nextTarget]);

  const loginMutation = useMutation({
    mutationFn: () => api.login({ username, password, next: nextTarget, theme }),
    onSuccess: (data) => {
      if (data.ok) {
        navigate(data.target || nextTarget, { replace: true });
        return;
      }
      setError(data.error || "Login failed.");
    },
    onError: () => setError("Login failed."),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    loginMutation.mutate();
  };

  return (
    <main className="mh-auth-shell">
      <div className="mh-auth-wrap">
        <div className="mh-auth-head">
          <h1>MediaHunter</h1>
          <p>Dashboard access is protected. Enter your configured credentials.</p>
        </div>

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

        <form className="mh-auth-card" onSubmit={onSubmit}>
          {!authQuery.data?.env_password_locked && (
            <label>
              Username
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </label>
          )}
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && <p className="mh-error">{error}</p>}
          <button type="submit" disabled={loginMutation.isPending || authQuery.isLoading}>Sign In</button>
        </form>
      </div>
    </main>
  );
}
