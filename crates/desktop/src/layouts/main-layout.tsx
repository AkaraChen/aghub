import { Surface } from "@heroui/react";
import { AppSidebar } from "../components/app-sidebar";

export function MainLayout({ children }: { children: React.ReactNode }) {
	return (
		<Surface variant="secondary" className="flex h-screen overflow-hidden">
			<AppSidebar />
			<main className="flex-1 overflow-hidden">{children}</main>
		</Surface>
	);
}
