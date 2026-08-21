import { Tabs } from "@heroui/react";
import { useQueryState } from "nuqs";
import { useTranslation } from "react-i18next";
import AgentsPanel from "./agents-panel";
import AppearancePanel from "./appearance-panel";
import ApplicationPanel from "./application-panel";
import IntegrationsPanel from "./integrations-panel";
import LogsPanel from "./logs-panel";
import SecurityPanel from "./security-panel";
import SkillPreferencesPanel from "./skill-preferences-panel";

export default function SettingsPage() {
	const { t } = useTranslation();
	const [selectedTab, setSelectedTab] = useQueryState("tab", {
		defaultValue: "appearance",
	});
	const activeTab = selectedTab === "security" ? "skills" : selectedTab;

	return (
		<div className="h-full overflow-y-auto">
			<div className="w-full p-4 sm:p-6">
				<Tabs
					selectedKey={activeTab}
					onSelectionChange={(key) => {
						setSelectedTab(key as string);
					}}
				>
					<div className="mb-2 flex items-center justify-between">
						<h2 className="text-xl font-semibold">
							{t("settings")}
						</h2>

						<Tabs.ListContainer>
							<Tabs.List
								aria-label="Settings sections"
								className="inline-flex w-auto"
							>
								<Tabs.Tab id="appearance">
									{t("appearance")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab id="agents">
									{t("agentManagement")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab id="integrations">
									{t("integrations")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab id="skills">
									{t("skills")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab id="logs">
									{t("logs")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab id="application">
									{t("application")}
									<Tabs.Indicator />
								</Tabs.Tab>
							</Tabs.List>
						</Tabs.ListContainer>
					</div>

					<Tabs.Panel id="appearance">
						<AppearancePanel />
					</Tabs.Panel>

					<Tabs.Panel id="agents">
						<AgentsPanel />
					</Tabs.Panel>

					<Tabs.Panel id="integrations">
						<IntegrationsPanel />
					</Tabs.Panel>

					<Tabs.Panel id="skills">
						<div className="space-y-6">
							<section
								aria-labelledby="skill-management-heading"
								className="space-y-3"
							>
								<h3
									id="skill-management-heading"
									className="px-1 text-sm font-medium text-foreground"
								>
									{t("skillManagement")}
								</h3>
								<SkillPreferencesPanel />
							</section>
							<section
								aria-labelledby="skill-security-heading"
								className="space-y-3 border-t border-separator pt-6"
							>
								<h3
									id="skill-security-heading"
									className="px-1 text-sm font-medium text-foreground"
								>
									{t("skillSecurity")}
								</h3>
								<div className="grid min-w-0 xl:grid-cols-2">
									<SecurityPanel />
								</div>
							</section>
						</div>
					</Tabs.Panel>

					<Tabs.Panel id="logs">
						<LogsPanel />
					</Tabs.Panel>

					<Tabs.Panel id="application">
						<ApplicationPanel />
					</Tabs.Panel>
				</Tabs>
			</div>
		</div>
	);
}
