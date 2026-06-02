import Bowser from "bowser";

let osName: string | null = null;

function getOSName(): string {
	osName ??= Bowser.getParser(navigator.userAgent).getOSName(true);
	return osName;
}

export function isMacOS(): boolean {
	return getOSName() === "macos";
}

export function isWindows(): boolean {
	return getOSName() === "windows";
}
