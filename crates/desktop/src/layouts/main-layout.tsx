import { Surface } from "@heroui/react";
import { AppSidebar } from "../components/app-sidebar";

export function MainLayout({ children }: { children: React.ReactNode }) {
	return (
		<Surface
			variant="default"
			className="flex h-screen flex-col overflow-hidden"
		>
			{/* Title bar - draggable */}
			<div
				data-tauri-drag-region
				className="flex h-9 shrink-0 items-center border-b border-border pl-20"
			>
				<div className="text-sm font-medium tracking-tight">aghub</div>
				<div className="flex-1" />
			</div>
			{/* Main content */}
			<div className="flex flex-1 overflow-hidden">
				<AppSidebar />
				<main className="flex-1 overflow-hidden">{children}</main>
			</div>
		</Surface>
	);
}
