import { Surface } from "@heroui/react";
import { AppSidebar } from "../components/app-sidebar";
import { WindowControls } from "../components/window-controls";

export function MainLayout({ children }: { children: React.ReactNode }) {
	const isMac = navigator.userAgent.toLowerCase().includes("mac");

	return (
		<Surface
			variant="secondary"
			className="flex h-screen flex-col overflow-hidden"
		>
			<div
				data-tauri-drag-region
				className="flex h-8 shrink-0 items-center justify-between border-b border-border pl-3"
			>
				<div className="pointer-events-none flex select-none items-center">
					{!isMac && (
						<span className="text-xs font-medium tracking-wide text-foreground/50">
							aghub
						</span>
					)}
				</div>
				<WindowControls />
			</div>
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<AppSidebar />
				<main className="flex-1 overflow-hidden">{children}</main>
			</div>
		</Surface>
	);
}
