import { Tabs } from "@heroui/react";
import { useQueryState } from "nuqs";
import { useTranslation } from "react-i18next";
import AgentsPanel from "./agents-panel";
import AppearancePanel from "./appearance-panel";
import ApplicationPanel from "./application-panel";
import IntegrationsPanel from "./integrations-panel";
import LogsPanel from "./logs-panel";
import PromptDataPanel from "./prompt-data-panel";
import RuleVersionDataPanel from "./rule-version-data-panel";
import SecurityPanel from "./security-panel";
import SkillPreferencesPanel from "./skill-preferences-panel";
import UsagePanel from "./usage-panel";

const settingsTabClassName = "whitespace-nowrap";

export default function SettingsPage() {
	const { t } = useTranslation();
	const [selectedTab, setSelectedTab] = useQueryState("tab", {
		defaultValue: "appearance",
	});
	const activeTab = selectedTab === "security" ? "skills" : selectedTab;

	return (
		<div className="h-full overflow-y-auto">
			<div
				data-testid="settings-content"
				className="mx-auto w-full max-w-5xl p-4 sm:p-6"
			>
				<Tabs
					className="min-w-0"
					selectedKey={activeTab}
					onSelectionChange={(key) => {
						setSelectedTab(key as string);
					}}
				>
					<div className="mb-2 flex min-w-0 flex-col items-start gap-3 lg:flex-row lg:items-center lg:justify-between">
						<h2 className="text-xl font-semibold">
							{t("settings")}
						</h2>

						<Tabs.ListContainer className="max-w-full">
							<Tabs.List
								aria-label="Settings sections"
								className="inline-flex w-auto"
							>
								<Tabs.Tab
									id="appearance"
									className={settingsTabClassName}
								>
									{t("appearance")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab
									id="agents"
									className={settingsTabClassName}
								>
									{t("agentManagement")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab
									id="integrations"
									className={settingsTabClassName}
								>
									{t("integrations")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab
									id="skills"
									className={settingsTabClassName}
								>
									{t("skills")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab
									id="prompts"
									className={settingsTabClassName}
								>
									{t("promptsAndRules")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab
									id="logs"
									className={settingsTabClassName}
								>
									{t("logs")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab
									id="usage"
									className={settingsTabClassName}
								>
									{t("usage")}
									<Tabs.Indicator />
								</Tabs.Tab>
								<Tabs.Tab
									id="application"
									className={settingsTabClassName}
								>
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

					<Tabs.Panel id="prompts">
						<div className="space-y-4">
							<PromptDataPanel />
							<RuleVersionDataPanel />
						</div>
					</Tabs.Panel>

					<Tabs.Panel id="logs">
						<LogsPanel />
					</Tabs.Panel>

					<Tabs.Panel id="usage">
						<UsagePanel />
					</Tabs.Panel>

					<Tabs.Panel id="application">
						<ApplicationPanel />
					</Tabs.Panel>
				</Tabs>
			</div>
		</div>
	);
}
