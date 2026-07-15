import { invoke } from "@tauri-apps/api/core";

export interface CcusageDiagnostics {
	/** The resolved binary path (or bare "ccusage" when found on PATH). */
	path: string;
}

/**
 * The ccusage binary the embedded API spawns. Local IPC (not an HTTP request)
 * because the API never returns raw filesystem paths.
 */
export function ccusageDiagnostics(): Promise<CcusageDiagnostics> {
	return invoke<CcusageDiagnostics>("ccusage_diagnostics");
}
