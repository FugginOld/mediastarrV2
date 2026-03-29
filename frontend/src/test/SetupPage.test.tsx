import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { SetupPage } from "../pages/SetupPage";
import * as apiClient from "../api/client";
import { ThemeProvider } from "../app/providers/ThemeProvider";

// Mock the API client
vi.mock("../api/client", () => ({
  api: {
    getAuthStatus: vi.fn(),
    setupPing: vi.fn(),
    testSetupDiscord: vi.fn(),
    completeSetup: vi.fn(),
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

describe("SetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders setup wizard with step 1 credentials", async () => {
    vi.mocked(apiClient.api.getAuthStatus).mockResolvedValue({
      ok: true,
      csrf_token: "test-token",
      auth_enabled: false,
      authenticated: true,
      setup_complete: false,
      theme: "system",
      env_password_locked: false,
    });

    renderWithProviders(<SetupPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    });
  });

  it("shows all 4 steps in step pills", async () => {
    vi.mocked(apiClient.api.getAuthStatus).mockResolvedValue({
      ok: true,
      csrf_token: "test-token",
      auth_enabled: false,
      authenticated: true,
      setup_complete: false,
      theme: "system",
      env_password_locked: false,
    });

    renderWithProviders(<SetupPage />);

    await waitFor(() => {
      expect(screen.getByText(/1\. Credentials/i)).toBeInTheDocument();
      expect(screen.getByText(/2\. Theme/i)).toBeInTheDocument();
      expect(screen.getByText(/3\. Instances/i)).toBeInTheDocument();
      expect(screen.getByText(/4\. Discord/i)).toBeInTheDocument();
    });
  });

  it("allows navigation between steps", async () => {
    const user = userEvent.setup();

    vi.mocked(apiClient.api.getAuthStatus).mockResolvedValue({
      ok: true,
      csrf_token: "test-token",
      auth_enabled: false,
      authenticated: true,
      setup_complete: false,
      theme: "system",
      env_password_locked: false,
    });

    renderWithProviders(<SetupPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/^password$/i), "password123");
    await user.type(screen.getByLabelText(/confirm password/i), "password123");

    // Click "Next: Theme" button
    const nextButton = screen.getByRole("button", { name: /next.*theme/i });
    await user.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText(/choose theme/i)).toBeInTheDocument();
    });
  });

  it("requires password confirmation to match", async () => {
    const user = userEvent.setup();

    vi.mocked(apiClient.api.getAuthStatus).mockResolvedValue({
      ok: true,
      csrf_token: "test-token",
      auth_enabled: false,
      authenticated: true,
      setup_complete: false,
      theme: "system",
      env_password_locked: false,
    });

    renderWithProviders(<SetupPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    });

    const usernameInput = screen.getByLabelText(/username/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    const confirmInput = screen.getByLabelText(/confirm password/i) as HTMLInputElement;

    await user.type(usernameInput, "testuser");
    await user.type(passwordInput, "password123");
    await user.type(confirmInput, "different");

    const nextButton = screen.getByRole("button", { name: /next.*theme/i });
    await user.click(nextButton);

    await waitFor(() => {
      expect(screen.getByText(/confirmation does not match/i)).toBeInTheDocument();
    });
  });

  it("requires at least one instance to be configured", async () => {
    const user = userEvent.setup();

    vi.mocked(apiClient.api.getAuthStatus).mockResolvedValue({
      ok: true,
      csrf_token: "test-token",
      auth_enabled: false,
      authenticated: true,
      setup_complete: false,
      theme: "system",
      env_password_locked: false,
    });

    renderWithProviders(<SetupPage />);

    // Navigate to step 3 (instances)
    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/^password$/i), "password123");
    await user.type(screen.getByLabelText(/confirm password/i), "password123");

    const credsNextButton = screen.getByRole("button", { name: /next.*theme/i });
    await user.click(credsNextButton);

    const themeNextButton = screen.getByRole("button", { name: /next.*instances/i });
    await user.click(themeNextButton);

    // Try to proceed without testing/saving instance
    const finishButton = screen.getByRole("button", { name: /next.*discord/i });
    await user.click(finishButton);

    await waitFor(() => {
      expect(screen.getByText(/click save after testing/i)).toBeInTheDocument();
    });
  });
});
