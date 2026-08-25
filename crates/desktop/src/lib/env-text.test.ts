import { describe, expect, it } from "vitest";
import { parseEnvText } from "./env-text";

describe("parseEnvText", () => {
	it("parses clipboard env syntax without Node runtime modules", () => {
		expect(
			parseEnvText(`
export API_KEY="first\\nsecond"
API_URL=https://api.example.com # endpoint
API_HOST: api.example.com
EMPTY=
HASHED='value # retained'
MULTILINE="first
second"
			`),
		).toEqual({
			API_KEY: "first\nsecond",
			API_URL: "https://api.example.com",
			API_HOST: "api.example.com",
			EMPTY: "",
			HASHED: "value # retained",
			MULTILINE: "first\nsecond",
		});
	});
});
