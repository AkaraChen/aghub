import { Tabs } from "@heroui/react";
import { useQueryState } from "nuqs";
import { useTranslation } from "react-i18next";
import AgentsPanel from "./agents-panel";
import AppearancePanel from "./appearance-panel";
import ApplicationPanel from "./application-panel";
import IntegrationsPanel from "./integrations-panel";

export default function SettingsPage() {
	const { t } = useTranslation();
	const [selectedTab, setSelectedTab] = useQueryState("tab", {
		defaultValue: "appearance",
	});

	return (
		<div className="h-full overflow-y-auto">
			<div className="w-full p-4 sm:p-6">
				<Tabs
					selectedKey={selectedTab}
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

					<Tabs.Panel id="application">
						<ApplicationPanel />
					</Tabs.Panel>
				</Tabs>
			</div>
		</div>
	);
}
