import { MinusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

function MaximizeIcon({ className }: { className?: string }) {
	return (
		<svg
			fill="none"
			viewBox="0 0 24 24"
			strokeWidth={1.5}
			stroke="currentColor"
			className={className}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M3.75 3.75v16.5h16.5V3.75H3.75z"
			/>
		</svg>
	);
}

function RestoreIcon({ className }: { className?: string }) {
	return (
		<svg
			fill="none"
			viewBox="0 0 24 24"
			strokeWidth={1.5}
			stroke="currentColor"
			className={className}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M16.5 8.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v8.25A2.25 2.25 0 006 16.5h2.25m8.25-8.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-7.5A2.25 2.25 0 018.25 18v-1.5m8.25-8.25h-6a2.25 2.25 0 00-2.25 2.25v6"
			/>
		</svg>
	);
}

export function WindowControls() {
	const isMac = navigator.userAgent.toLowerCase().includes("mac");

	const [isMaximized, setIsMaximized] = useState(false);
	const [isTauri, setIsTauri] = useState(true);

	useEffect(() => {
		let unlisten: (() => void) | null = null;

		const setup = async () => {
			try {
				const appWindow = getCurrentWindow();
				setIsMaximized(await appWindow.isMaximized());
				unlisten = await appWindow.onResized(async () => {
					setIsMaximized(await appWindow.isMaximized());
				});
			} catch {
				// Not running inside Tauri
				setIsTauri(false);
			}
		};
		setup();

		return () => {
			if (unlisten) unlisten();
		};
	}, []);

	if (isMac || !isTauri) return null;

	return (
		<div className="flex h-full items-stretch">
			<button
				type="button"
				className="inline-flex w-12 cursor-default items-center justify-center text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
				onClick={async () => {
					try {
						await getCurrentWindow().minimize();
					} catch {}
				}}
				tabIndex={-1}
			>
				<MinusIcon className="h-4 w-4" />
			</button>
			<button
				type="button"
				className="inline-flex w-12 cursor-default items-center justify-center text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
				onClick={async () => {
					try {
						const appWindow = getCurrentWindow();
						if (await appWindow.isMaximized()) {
							await appWindow.unmaximize();
						} else {
							await appWindow.maximize();
						}
					} catch {}
				}}
				tabIndex={-1}
			>
				{isMaximized ? (
					<RestoreIcon className="h-4 w-4" />
				) : (
					<MaximizeIcon className="h-3.5 w-3.5" />
				)}
			</button>
			<button
				type="button"
				className="inline-flex w-12 cursor-default items-center justify-center text-muted transition-colors hover:bg-danger hover:text-white"
				onClick={async () => {
					try {
						await getCurrentWindow().close();
					} catch {}
				}}
				tabIndex={-1}
			>
				<XMarkIcon className="h-4 w-4" />
			</button>
		</div>
	);
}
