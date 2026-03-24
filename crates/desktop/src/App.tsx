import { Spinner } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/react";
import { Suspense, useEffect, useState } from "react";
import { Route, Router, Switch } from "wouter";
import { Redirect } from "./components/redirect";
import { ErrorBoundary } from "./components/ui/error-boundary";
import { MainLayout } from "./layouts/main-layout";
import { initStore } from "./lib/store";
import ProjectDetailPage from "./pages/project/detail";
import SettingsPage from "./pages/settings";
import CustomAgentsPage from "./pages/settings/custom-agents";
import MCPServersPage from "./pages/settings/mcp-servers";
import SkillsPage from "./pages/settings/skills";
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
			<div className="
     flex w-80 shrink-0 items-center justify-center border-r border-border
   ">
				<Spinner />
			</div>
			<div className="flex-1" />
		</div>
	);
}

function App() {
	const [isStoreReady, setIsStoreReady] = useState(false);

	useEffect(() => {
		initStore()
			.then(() => setIsStoreReady(true))
			.catch((err) => {
				console.error("Failed to initialize store:", err);
			});
	}, []);

	if (!isStoreReady) {
		return (
			<div className="flex h-screen items-center justify-center">
				<Spinner size="lg" />
			</div>
		);
	}

	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider>
				<ServerProvider>
					<AgentAvailabilityProvider>
						<NuqsAdapter>
							<Router>
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
