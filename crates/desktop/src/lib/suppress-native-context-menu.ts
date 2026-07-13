/**
 * The WebView pops its own context menu (Open Link, Inspect Element, …)
 * on right-click. Suppress it everywhere except editable fields — where
 * the native cut/copy/paste menu is worth keeping — so only the app's
 * own context menus appear. Elements with a custom menu already call
 * preventDefault themselves; this covers everything else.
 */
export function suppressNativeContextMenu() {
	window.addEventListener("contextmenu", (event) => {
		const target = event.target as HTMLElement | null;
		if (target?.closest("input, textarea, [contenteditable]")) {
			return;
		}
		event.preventDefault();
	});
}
