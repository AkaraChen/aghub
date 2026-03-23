import { Spinner } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { Route, Router, Switch } from "wouter";
import { ErrorBoundary } from "./components/ui/error-boundary";
import { SettingsLayout } from "./layouts/settings-layout";
import { initStore } from "./lib/store";
import { AgentAvailabilityProvider } from "./providers/agent-availability";
import { ServerProvider } from "./providers/server";
import { ThemeProvider } from "./providers/theme";
import "./lib/i18n";
import ProjectDetailPage from "./pages/project/detail";
import SettingsPage from "./pages/settings";
import CustomAgentsPage from "./pages/settings/custom-agents";
import MCPServersPage from "./pages/settings/mcp-servers";
import SkillsPage from "./pages/settings/skills";
import { Redirect } from "./components/redirect";

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
			<div className="w-80 shrink-0 border-r border-border flex items-center justify-center">
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
						<Router>
							<Switch>
								<Route path="/">
									<Redirect to="/mcp" />
								</Route>
								<Route path="/skills">
									<SettingsLayout>
										<ErrorBoundary>
											<Suspense
												fallback={<SkillsPageSkeleton />}
											>
												<SkillsPage />
											</Suspense>
										</ErrorBoundary>
									</SettingsLayout>
								</Route>
								<Route path="/mcp">
									<SettingsLayout>
										<ErrorBoundary>
											<Suspense
												fallback={<SkillsPageSkeleton />}
											>
												<MCPServersPage />
											</Suspense>
										</ErrorBoundary>
									</SettingsLayout>
								</Route>
								<Route path="/settings">
									<SettingsLayout>
										<SettingsPage />
									</SettingsLayout>
								</Route>
								<Route path="/settings/custom-agents">
									<SettingsLayout>
										<CustomAgentsPage />
									</SettingsLayout>
								</Route>
								<Route path="/projects/:id">
									<SettingsLayout>
										<ProjectDetailPage />
									</SettingsLayout>
								</Route>
								<Route>
									<Redirect to="/mcp" />
								</Route>
							</Switch>
						</Router>
					</AgentAvailabilityProvider>
				</ServerProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}

export default App;
