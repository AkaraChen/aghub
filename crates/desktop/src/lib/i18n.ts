import i18n from "i18next";
import LanguageDetector, {
	type CustomDetector,
} from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";
import zhTW from "./locales/zh-TW";

const SUPPORTED_LANGUAGES = ["en", "zh-CN", "zh-TW"];

/**
 * Resolve a language tag to a supported locale, or undefined if unrecognized.
 * e.g. "zh-TW" → "zh-TW", "zh-HK" → "zh-TW", "zh-Hans" → "zh-CN",
 *      "zh" → "zh-CN", "en-US" → "en", "fr" → undefined
 */
function resolveLanguage(detected: string): string | undefined {
	if (SUPPORTED_LANGUAGES.includes(detected)) return detected;

	const lower = detected.toLowerCase();

	if (lower.startsWith("zh")) {
		if (
			lower.includes("tw") ||
			lower.includes("hk") ||
			lower.includes("mo") ||
			lower.includes("hant")
		) {
			return "zh-TW";
		}
		return "zh-CN";
	}

	if (lower.startsWith("en")) return "en";

	return undefined;
}

// Custom detector that resolves OS/browser language to supported locales
const osLanguageDetector: CustomDetector = {
	name: "osLanguageDetector",
	lookup() {
		const stored = localStorage.getItem("language");
		if (stored && SUPPORTED_LANGUAGES.includes(stored)) return stored;

		// Respect navigator.languages priority order
		const candidates = navigator.languages ?? [navigator.language];
		for (const candidate of candidates) {
			const resolved = resolveLanguage(candidate);
			if (resolved) return resolved;
		}

		return "en";
	},
	cacheUserLanguage(lng: string) {
		localStorage.setItem("language", lng);
	},
};

const detector = new LanguageDetector();
detector.addDetector(osLanguageDetector);

i18n.use(detector)
	.use(initReactI18next)
	.init({
		resources: {
			en: { translation: en },
			"zh-CN": { translation: zhCN },
			"zh-TW": { translation: zhTW },
		},
		fallbackLng: "en",
		detection: {
			order: ["osLanguageDetector"],
			caches: [],
		},
		interpolation: {
			escapeValue: false,
		},
	});
