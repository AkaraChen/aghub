import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import zhHans from "./locales/zh-Hans";
import zhHant from "./locales/zh-Hant";

const SUPPORTED_LANGUAGES = ["en", "zh-Hans", "zh-Hant"];

// Browser detection reports Chinese as region tags like zh-TW or zh-HK.
// Normalize once at the detector boundary so i18next can match on script.
function normalizeDetectedLanguage(lng: string) {
	if (!lng.startsWith("zh")) return lng;

	try {
		const script = new Intl.Locale(lng).maximize().script;
		return script === "Hant" ? "zh-Hant" : "zh-Hans";
	} catch {
		return lng;
	}
}

i18n.use(LanguageDetector)
	.use(initReactI18next)
	.init({
		resources: {
			en: { translation: en },
			"zh-Hans": { translation: zhHans },
			"zh-Hant": { translation: zhHant },
		},
		supportedLngs: SUPPORTED_LANGUAGES,
		fallbackLng: "en",
		detection: {
			order: ["localStorage", "navigator"],
			lookupLocalStorage: "language",
			caches: ["localStorage"],
			convertDetectedLanguage: normalizeDetectedLanguage,
		},
		interpolation: {
			escapeValue: false,
		},
	});
