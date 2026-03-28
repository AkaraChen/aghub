import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import zhHans from "./locales/zh-Hans";
import zhHant from "./locales/zh-Hant";

// Keep only script-based translation bundles and let region tags alias to them.
const SUPPORTED_LANGUAGES = [
	"en",
	"zh",
	"zh-CN",
	"zh-SG",
	"zh-TW",
	"zh-HK",
	"zh-MO",
	"zh-Hans",
	"zh-Hant",
];

const FALLBACK_LANGUAGES = {
	default: ["en"],
	zh: ["zh-Hans"],
	"zh-CN": ["zh-Hans"],
	"zh-SG": ["zh-Hans"],
	"zh-TW": ["zh-Hant"],
	"zh-HK": ["zh-Hant"],
	"zh-MO": ["zh-Hant"],
};

i18n.use(LanguageDetector)
	.use(initReactI18next)
	.init({
		resources: {
			en: { translation: en },
			"zh-Hans": { translation: zhHans },
			"zh-Hant": { translation: zhHant },
		},
		supportedLngs: SUPPORTED_LANGUAGES,
		fallbackLng: FALLBACK_LANGUAGES,
		detection: {
			order: ["localStorage", "navigator"],
			lookupLocalStorage: "language",
			caches: ["localStorage"],
		},
		interpolation: {
			escapeValue: false,
		},
	});
