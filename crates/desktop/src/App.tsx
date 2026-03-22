import { Suspense } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Router, Route, Switch } from "wouter"
import { Spinner } from "@heroui/react"
import { ServerProvider } from "./providers/server"
import { ThemeProvider } from "./providers/theme"
import { SettingsLayout } from "./layouts/settings-layout"
import { ErrorBoundary } from "./components/ui/error-boundary"
import HomePage from "./pages/home"
import SkillsPage from "./pages/settings/skills"
import MCPServersPage from "./pages/settings/mcp-servers"
import CustomAgentsPage from "./pages/settings/custom-agents"
import SettingsPage from "./pages/settings"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function SkillsPageSkeleton() {
  return (
    <div className="flex h-full">
      <div className="w-80 shrink-0 border-r border-border flex items-center justify-center">
        <Spinner />
      </div>
      <div className="flex-1" />
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ServerProvider>
        <Router>
          <Switch>
            <Route path="/" component={HomePage} />
            <Route path="/settings/skills">
              <SettingsLayout>
                <ErrorBoundary>
                  <Suspense fallback={<SkillsPageSkeleton />}>
                    <SkillsPage />
                  </Suspense>
                </ErrorBoundary>
              </SettingsLayout>
            </Route>
            <Route path="/settings/mcp-servers">
              <SettingsLayout>
                <ErrorBoundary>
                  <Suspense fallback={<SkillsPageSkeleton />}>
                    <MCPServersPage />
                  </Suspense>
                </ErrorBoundary>
              </SettingsLayout>
            </Route>
            <Route path="/settings/custom-agents">
              <SettingsLayout><CustomAgentsPage /></SettingsLayout>
            </Route>
            <Route path="/settings">
              <SettingsLayout><SettingsPage /></SettingsLayout>
            </Route>
            <Route>
              <SettingsLayout>
                <ErrorBoundary>
                  <Suspense fallback={<SkillsPageSkeleton />}>
                    <SkillsPage />
                  </Suspense>
                </ErrorBoundary>
              </SettingsLayout>
            </Route>
          </Switch>
        </Router>
        </ServerProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export default App
