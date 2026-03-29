import { Spinner, Toast } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { NuqsAdapter } from "nuqs/adapters/react";
import { Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useKeyBindings } from "rooks";
import { Route, Router, Switch, useLocation } from "wouter";
import { OnboardingController } from "./components/onboarding-controller";
import { Redirect } from "./components/redirect";
import { ErrorBoundary } from "./components/ui/error-boundary";
import { MainLayout } from "./layouts/main-layout";
import { setupAppMenu } from "./lib/menu";
import { initStore } from "./lib/store";
import ProjectDetailPage from "./pages/project/detail";
import SettingsPage from "./pages/settings";
import CustomAgentsPage from "./pages/settings/custom-agents";
import MCPServersPage from "./pages/settings/mcp-servers";
import SkillsPage from "./pages/settings/skills";
import SkillsShPage from "./pages/skills-sh";
import SkillsSearchPage from "./pages/skills-sh/search";
import { AgentAvailabilityProvider } from "./providers/agent-availability";
import { ServerProvider } from "./providers/server";
import { ThemeProvider } from "./providers/theme";
import "./lib/i18n";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 1,
			refetchOnWindowFocus: false,
		},
	},
});

function SkillsPageSkeleton() {
	return (
		<div className="flex h-full">
			<div
				className="
      flex w-80 shrink-0 items-center justify-center border-r border-border
    "
			>
				<Spinner />
			</div>
			<div className="flex-1" />
		</div>
	);
}

function App() {
	const [isStoreReady, setIsStoreReady] = useState(false);
	const [, setLocation] = useLocation();
	const { t, i18n } = useTranslation();

	useEffect(() => {
		setupAppMenu(t);
	}, [t, i18n.language]);

	useEffect(() => {
		initStore()
			.then(() => setIsStoreReady(true))
			.catch((err) => {
				console.error("Failed to initialize store:", err);
			});
	}, []);

	useEffect(() => {
		const unlisten = listen<string>("navigate", (event) => {
			setLocation(event.payload);
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [setLocation]);

	useKeyBindings({
		",": (event) => {
			if (event.metaKey && !event.ctrlKey && !event.altKey) {
				event.preventDefault();
				setLocation("/settings");
			}
		},
	});

	if (!isStoreReady) {
		return (
			<div className="flex h-screen items-center justify-center">
				<Spinner size="lg" />
			</div>
		);
	}

	return (
		<QueryClientProvider client={queryClient}>
			<Toast.Provider placement="bottom end" />
			<ThemeProvider>
				<ServerProvider>
					<AgentAvailabilityProvider>
						<NuqsAdapter>
							<Router>
								<OnboardingController />
								<Switch>
									<Route path="/">
										<Redirect to="/mcp" />
									</Route>
									<Route path="/skills">
										<MainLayout>
											<ErrorBoundary>
												<Suspense
													fallback={
														<SkillsPageSkeleton />
													}
												>
													<SkillsPage />
												</Suspense>
											</ErrorBoundary>
										</MainLayout>
									</Route>
									<Route path="/mcp">
										<MainLayout>
											<ErrorBoundary>
												<Suspense
													fallback={
														<SkillsPageSkeleton />
													}
												>
													<MCPServersPage />
												</Suspense>
											</ErrorBoundary>
										</MainLayout>
									</Route>
									<Route path="/skills-sh/search">
										<MainLayout>
											<ErrorBoundary>
												<Suspense
													fallback={
														<SkillsPageSkeleton />
													}
												>
													<SkillsSearchPage />
												</Suspense>
											</ErrorBoundary>
										</MainLayout>
									</Route>
									<Route path="/skills-sh">
										<MainLayout>
											<ErrorBoundary>
												<Suspense
													fallback={
														<SkillsPageSkeleton />
													}
												>
													<SkillsShPage />
												</Suspense>
											</ErrorBoundary>
										</MainLayout>
									</Route>
									<Route path="/settings">
										<MainLayout>
											<SettingsPage />
										</MainLayout>
									</Route>
									<Route path="/settings/custom-agents">
										<MainLayout>
											<CustomAgentsPage />
										</MainLayout>
									</Route>
									<Route path="/projects/:id">
										<MainLayout>
											<ProjectDetailPage />
										</MainLayout>
									</Route>
									<Route>
										<Redirect to="/mcp" />
									</Route>
								</Switch>
							</Router>
						</NuqsAdapter>
					</AgentAvailabilityProvider>
				</ServerProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}

export default App;
