import { Spinner, Toast, toast } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import {
	getCurrent as getCurrentDeepLinks,
	onOpenUrl,
} from "@tauri-apps/plugin-deep-link";
import { NuqsAdapter } from "nuqs/adapters/react";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useKeyBindings } from "rooks";
import { Route, Router, Switch, useLocation } from "wouter";
import { AutoUpdateChecker } from "./components/auto-update-checker";
import { DeepLinkImportModal } from "./components/deep-link-import-modal";
import { OnboardingController } from "./components/onboarding-controller";
import { Redirect } from "./components/redirect";
import { ErrorBoundary } from "./components/ui/error-boundary";
import { MainLayout } from "./layouts/main-layout";
import type { DeepLinkImportIntent } from "./lib/deep-link";
import { parseDeepLink } from "./lib/deep-link";
import { setupAppMenu } from "./lib/menu";
import { initStore } from "./lib/store";
import HomePage from "./pages/home";
import InferenceProvidersPage from "./pages/inference-providers";
import MarketPage from "./pages/market";
import PluginsPage from "./pages/plugins";
import ProjectDetailPage from "./pages/project/detail";
import SearchResultsPage from "./pages/search";
import SettingsPage from "./pages/settings";
import CustomAgentsPage from "./pages/settings/custom-agents";
import MCPServersPage from "./pages/settings/mcp-servers";
import SkillsPage from "./pages/settings/skills";
import SubAgentsPage from "./pages/settings/sub-agents";
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

function PageSkeleton() {
	return (
		<div className="flex h-full items-center justify-center">
			<Spinner />
		</div>
	);
}

function App() {
	const [isStoreReady, setIsStoreReady] = useState(false);
	const [pendingIntents, setPendingIntents] = useState<
		DeepLinkImportIntent[]
	>([]);
	const [, setLocation] = useLocation();
	const { t, i18n } = useTranslation();

	const currentIntent = pendingIntents[0] ?? null;

	const processNextIntent = useCallback(() => {
		setPendingIntents((prev) => prev.slice(1));
	}, []);

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

	useEffect(() => {
		let isMounted = true;
		let unlistenDeepLink: (() => void) | null = null;

		const handleUrls = (urls: string[] | null) => {
			if (!isMounted || !urls || urls.length === 0) {
				return;
			}

			const newIntents = urls
				.map(parseDeepLink)
				.filter((result) => {
					if (!result.ok) {
						toast.danger(t(result.error));
					}
					return result.ok;
				})
				.map((result) => result.intent);

			if (newIntents.length > 0) {
				setPendingIntents((prev) => prev.concat(newIntents));
			}
		};

		void getCurrentDeepLinks()
			.then(handleUrls)
			.catch((error) => {
				console.error("Failed to read current deep link:", error);
			});

		void onOpenUrl((urls) => {
			handleUrls(urls);
		})
			.then((dispose) => {
				unlistenDeepLink = dispose;
			})
			.catch((error) => {
				console.error("Failed to subscribe to deep links:", error);
			});

		return () => {
			isMounted = false;
			unlistenDeepLink?.();
		};
	}, [t]);

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
								<AutoUpdateChecker />
								<Switch>
									<Route path="/">
										<MainLayout>
											<ErrorBoundary>
												<Suspense
													fallback={<PageSkeleton />}
												>
													<HomePage />
												</Suspense>
											</ErrorBoundary>
										</MainLayout>
									</Route>

									<Route path="/search">
										<MainLayout>
											<ErrorBoundary>
												<Suspense
													fallback={<PageSkeleton />}
												>
													<SearchResultsPage />
												</Suspense>
											</ErrorBoundary>
										</MainLayout>
									</Route>

									<Route path="/agents/:agentId/:rest*">
										{(params) => (
											<Redirect
												to={`/skills?agent=${encodeURIComponent(params.agentId)}`}
											/>
										)}
									</Route>

									<Route path="/agents/:agentId">
										{(params) => (
											<Redirect
												to={`/skills?agent=${encodeURIComponent(params.agentId)}`}
											/>
										)}
									</Route>

									<Route path="/market">
										<MainLayout>
											<ErrorBoundary>
												<Suspense
													fallback={<PageSkeleton />}
												>
													<MarketPage />
												</Suspense>
											</ErrorBoundary>
										</MainLayout>
									</Route>

									<Route path="/market/search">
										<MainLayout>
											<ErrorBoundary>
												<Suspense
													fallback={<PageSkeleton />}
												>
													<SkillsSearchPage />
												</Suspense>
											</ErrorBoundary>
										</MainLayout>
									</Route>

									<Route path="/library">
										<Redirect to="/market" />
									</Route>
									<Route path="/library/search">
										<Redirect to="/market/search" />
									</Route>

									<Route path="/skills">
										<MainLayout>
											<ErrorBoundary>
												<Suspense
													fallback={<PageSkeleton />}
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
													fallback={<PageSkeleton />}
												>
													<MCPServersPage />
												</Suspense>
											</ErrorBoundary>
										</MainLayout>
									</Route>
									<Route path="/sub-agents">
										<MainLayout>
											<ErrorBoundary>
												<Suspense
													fallback={<PageSkeleton />}
												>
													<SubAgentsPage />
												</Suspense>
											</ErrorBoundary>
										</MainLayout>
									</Route>
									<Route path="/inference-providers">
										<MainLayout>
											<ErrorBoundary>
												<InferenceProvidersPage />
											</ErrorBoundary>
										</MainLayout>
									</Route>
									<Route path="/skills-sh">
										<Redirect to="/market" />
									</Route>
									<Route path="/skills-sh/search">
										<Redirect to="/market/search" />
									</Route>

									<Route path="/cc-plugins">
										<MainLayout>
											<ErrorBoundary>
												<Suspense
													fallback={<PageSkeleton />}
												>
													<PluginsPage />
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
										<Redirect to="/" />
									</Route>
								</Switch>
								<DeepLinkImportModal
									intent={currentIntent}
									onComplete={processNextIntent}
								/>
							</Router>
						</NuqsAdapter>
					</AgentAvailabilityProvider>
				</ServerProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}

export default App;
