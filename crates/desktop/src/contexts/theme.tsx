import type { ReactNode } from "react";
import { createContext } from "react";

export type Theme = "light" | "dark" | "system";

export interface ThemeContextValue {
	theme: Theme;
	setTheme: (theme: Theme) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
	children: ReactNode;
}
