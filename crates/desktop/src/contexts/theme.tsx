import type { ReactNode } from "react";
import { createContext, use } from "react";

export type Theme = "light" | "dark" | "system";

export interface ThemeContextValue {
	theme: Theme;
	setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useThemeContext(): ThemeContextValue {
	const context = use(ThemeContext);
	if (!context) throw new Error("useTheme must be used within ThemeProvider");
	return context;
}

export interface ThemeProviderProps {
	children: ReactNode;
}
