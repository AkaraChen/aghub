import { Surface } from "@heroui/react";
import { AppSidebar } from "../components/app-sidebar";

export function MainLayout({ children }: { children: React.ReactNode }) {
	return (
		<Surface
			variant="secondary"
			className="flex h-screen flex-col overflow-hidden"
		>
			<div
				data-tauri-drag-region
				className="h-8 shrink-0 border-b border-border"
			/>
			<div className="flex min-h-0 flex-1 overflow-hidden">
				<AppSidebar />
				<main className="flex-1 overflow-hidden">{children}</main>
			</div>
		</Surface>
	);
}
