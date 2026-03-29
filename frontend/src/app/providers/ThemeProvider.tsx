import { PropsWithChildren, createContext, useContext, useEffect, useMemo, useState } from "react";

type ThemeName = "system" | "github-inspired" | "discord-inspired" | "plex-inspired";

type ThemeContextType = {
  theme: ThemeName;
  setTheme: (next: ThemeName) => void;
};

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setTheme] = useState<ThemeName>(() => {
    if (window.location.pathname.startsWith("/setup")) {
      return "system";
    }
    const saved = window.localStorage.getItem("mh-theme");
    if (saved === "system" || saved === "github-inspired" || saved === "discord-inspired" || saved === "plex-inspired") {
      return saved;
    }
    return "system";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem("mh-theme", theme);
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
