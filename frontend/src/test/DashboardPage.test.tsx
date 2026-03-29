import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { DashboardPage } from "../pages/DashboardPage";
import * as apiClient from "../api/client";
import { ThemeProvider } from "../app/providers/ThemeProvider";

const makeState = () => ({
  running: false,
  last_run: null,
  next_run: null,
  cycle_count: 0,
  total_searches: 0,
  daily_count: 0,
  daily_limit: 20,
  daily_remaining: 20,
  server_time: "2026-03-28 22:00:00",
  server_tz: "UTC",
  activity_log: [],
  inst_stats: {},
  instances: [],
  config: {
    hunt_missing_delay: 900,
    max_searches_per_run: 10,
    daily_limit: 20,
    cooldown_days: 7,
    request_timeout: 30,
    jitter_max: 300,
    sonarr_search_mode: "season" as const,
    search_upgrades: true,
    scan_interval_days: 7,
    timezone: "UTC",
    auto_start: false,
    dry_run: false,
    instance_count: 0,
    theme: "system" as const,
  },
});

// Mock the API client
vi.mock("../api/client", () => ({
  api: {
    getAuthStatus: vi.fn(),
    getState: vi.fn(),
    logout: vi.fn(),
    control: vi.fn(),
    updateConfig: vi.fn(),
    getTimezones: vi.fn(),
    getHistory: vi.fn(),
    getHistoryStats: vi.fn(),
  },
}));

// Wrapper component with providers
const renderWithProviders = (component: React.ReactElement) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ThemeProvider>
          {component}
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders dashboard with auth status indicator", async () => {
    vi.mocked(apiClient.api.getAuthStatus).mockResolvedValue({
      ok: true,
      csrf_token: "test-token",
      auth_enabled: true,
      authenticated: true,
      setup_complete: true,
      theme: "system",
      auth_username: "admin",
    });

    vi.mocked(apiClient.api.getState).mockResolvedValue(makeState());

    vi.mocked(apiClient.api.getTimezones).mockResolvedValue({
      ok: true,
      timezones: ["UTC", "US/Eastern", "US/Pacific"],
    });

    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText(/authenticated/i)).toBeInTheDocument();
    });
  });

  it("shows logout button when auth is enabled", async () => {
    vi.mocked(apiClient.api.getAuthStatus).mockResolvedValue({
      ok: true,
      csrf_token: "test-token",
      auth_enabled: true,
      authenticated: true,
      setup_complete: true,
      theme: "system",
      auth_username: "admin",
    });

    vi.mocked(apiClient.api.getState).mockResolvedValue(makeState());

    vi.mocked(apiClient.api.getTimezones).mockResolvedValue({
      ok: true,
      timezones: ["UTC"],
    });

    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /logout/i })).toBeInTheDocument();
    });
  });

  it("displays start/stop controls", async () => {
    vi.mocked(apiClient.api.getAuthStatus).mockResolvedValue({
      ok: true,
      csrf_token: "test-token",
      auth_enabled: false,
      authenticated: true,
      setup_complete: true,
      theme: "system",
    });

    vi.mocked(apiClient.api.getState).mockResolvedValue(makeState());

    vi.mocked(apiClient.api.getTimezones).mockResolvedValue({
      ok: true,
      timezones: ["UTC"],
    });

    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /run now/i })).toBeInTheDocument();
    });
  });

  it("allows switching between tabs", async () => {
    const user = userEvent.setup();

    vi.mocked(apiClient.api.getAuthStatus).mockResolvedValue({
      ok: true,
      csrf_token: "test-token",
      auth_enabled: false,
      authenticated: true,
      setup_complete: true,
      theme: "system",
    });

    vi.mocked(apiClient.api.getState).mockResolvedValue(makeState());

    vi.mocked(apiClient.api.getTimezones).mockResolvedValue({
      ok: true,
      timezones: ["UTC"],
    });

    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /dashboard/i })).toBeInTheDocument();
    });

    const settingsTab = screen.getByRole("button", { name: /settings/i });
    await user.click(settingsTab);

    await waitFor(() => {
      expect(screen.getByText(/time display/i)).toBeInTheDocument();
    });
  });
});
