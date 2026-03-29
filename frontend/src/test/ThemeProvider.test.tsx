import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme } from "../app/providers/ThemeProvider";

function ThemeTestComponent() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <div data-testid="current-theme">{theme}</div>
      <button onClick={() => setTheme("github-inspired")}>Set GitHub</button>
      <button onClick={() => setTheme("discord-inspired")}>Set Discord</button>
      <button onClick={() => setTheme("plex-inspired")}>Set Plex</button>
      <button onClick={() => setTheme("system")}>Set System</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("initializes with system theme by default", () => {
    render(
      <ThemeProvider>
        <ThemeTestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId("current-theme")).toHaveTextContent("system");
  });

  it("allows theme switching", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <ThemeTestComponent />
      </ThemeProvider>
    );

    const githubButton = screen.getByRole("button", { name: /set github/i });
    await user.click(githubButton);

    await waitFor(() => {
      expect(screen.getByTestId("current-theme")).toHaveTextContent("github-inspired");
    });
  });

  it("persists theme selection to localStorage", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <ThemeTestComponent />
      </ThemeProvider>
    );

    const discordButton = screen.getByRole("button", { name: /set discord/i });
    await user.click(discordButton);

    await waitFor(() => {
      expect(localStorage.getItem("mh-theme")).toBe("discord-inspired");
    });
  });

  it("applies theme class to document root", async () => {
    const user = userEvent.setup();

    render(
      <ThemeProvider>
        <ThemeTestComponent />
      </ThemeProvider>
    );

    const plexButton = screen.getByRole("button", { name: /set plex/i });
    await user.click(plexButton);

    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("plex-inspired");
    });
  });

  it("loads saved theme from localStorage on initialization", () => {
    localStorage.setItem("mh-theme", "discord-inspired");

    render(
      <ThemeProvider>
        <ThemeTestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId("current-theme")).toHaveTextContent("discord-inspired");
  });

  it("forces system theme on /setup route", () => {
    // Mock the current path as /setup
    Object.defineProperty(window, "location", {
      value: { pathname: "/setup" },
      writable: true,
    });

    localStorage.setItem("mh-theme", "discord-inspired");

    render(
      <ThemeProvider>
        <ThemeTestComponent />
      </ThemeProvider>
    );

    // Should use system theme on /setup, ignoring saved preference
    expect(screen.getByTestId("current-theme")).toHaveTextContent("system");
  });
});
