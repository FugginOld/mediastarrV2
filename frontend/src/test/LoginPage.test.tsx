import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { LoginPage } from "../pages/LoginPage";
import * as apiClient from "../api/client";
import { ThemeProvider } from "../app/providers/ThemeProvider";

// Mock the API client
vi.mock("../api/client", () => ({
  api: {
    getAuthStatus: vi.fn(),
    login: vi.fn(),
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
        <ThemeProvider>{component}</ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders login form with username and password fields", async () => {
    vi.mocked(apiClient.api.getAuthStatus).mockResolvedValue({
      ok: true,
      csrf_token: "test-token",
      auth_enabled: true,
      authenticated: false,
      setup_complete: true,
      theme: "system",
      env_password_locked: false,
    });

    renderWithProviders(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    });
  });

  it("submits login form with correct credentials", async () => {
    const user = userEvent.setup();
    
    vi.mocked(apiClient.api.getAuthStatus).mockResolvedValue({
      ok: true,
      csrf_token: "test-token",
      auth_enabled: true,
      authenticated: false,
      setup_complete: true,
      theme: "system",
      env_password_locked: false,
    });

    vi.mocked(apiClient.api.login).mockResolvedValue({
      ok: true,
      target: "/",
    });

    renderWithProviders(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    });

    const usernameInput = screen.getByLabelText(/username/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    const submitButton = screen.getByRole("button", { name: /sign in/i });

    await user.clear(usernameInput);
    await user.type(usernameInput, "testuser");
    await user.type(passwordInput, "testpass123");
    await user.click(submitButton);

    await waitFor(() => {
      expect(apiClient.api.login).toHaveBeenCalledWith(
        expect.objectContaining({
          username: "testuser",
          password: "testpass123",
        })
      );
    });
  });

  it("displays error on failed login", async () => {
    const user = userEvent.setup();

    vi.mocked(apiClient.api.getAuthStatus).mockResolvedValue({
      ok: true,
      csrf_token: "test-token",
      auth_enabled: true,
      authenticated: false,
      setup_complete: true,
      theme: "system",
      env_password_locked: false,
    });

    vi.mocked(apiClient.api.login).mockRejectedValue(
      new Error("Invalid credentials")
    );

    renderWithProviders(<LoginPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    });

    const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
    const submitButton = screen.getByRole("button", { name: /sign in/i });
    await user.type(passwordInput, "badpass");
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid|failed/i)).toBeInTheDocument();
    });
  });

  it("allows theme selection", async () => {
    const user = userEvent.setup();

    vi.mocked(apiClient.api.getAuthStatus).mockResolvedValue({
      ok: true,
      csrf_token: "test-token",
      auth_enabled: true,
      authenticated: false,
      setup_complete: true,
      theme: "system",
      env_password_locked: false,
    });

    renderWithProviders(<LoginPage />);

    await waitFor(() => {
      const themeButtons = screen.getAllByRole("button");
      expect(themeButtons.length).toBeGreaterThan(2);
    });
  });
});
