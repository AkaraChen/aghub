import { Drawer, Tabs } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { GatewayInstanceDto } from "../../generated/dto";
import { GatewayAccountsPanel } from "./accounts-panel";
import { GatewayApiKeysPanel } from "./api-keys-panel";
import { GatewayNotRunningNotice } from "./gateway-status";
import { GatewayUsagePanel } from "./usage-panel";

interface GatewayAccountsDrawerProps {
	/** `null` keeps the drawer closed. */
	instance: GatewayInstanceDto | null;
	instances: GatewayInstanceDto[];
	onClose: () => void;
}

export function GatewayAccountsDrawer({
	instance,
	instances,
	onClose,
}: GatewayAccountsDrawerProps) {
	const { t } = useTranslation();

	return (
		<Drawer.Backdrop
			isOpen={instance !== null}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Drawer.Content placement="right" className="w-full max-w-2xl">
				<Drawer.Dialog>
					<Drawer.CloseTrigger />
					<Drawer.Header>
						<Drawer.Heading>{instance?.name}</Drawer.Heading>
					</Drawer.Header>
					<Drawer.Body>
						{instance &&
							(instance.status === "running" ? (
								<Tabs defaultSelectedKey="accounts">
									<Tabs.ListContainer>
										<Tabs.List
											aria-label={t("gatewayTabAccounts")}
											className="inline-flex w-auto"
										>
											<Tabs.Tab id="accounts">
												{t("gatewayTabAccounts")}
												<Tabs.Indicator />
											</Tabs.Tab>
											<Tabs.Tab id="keys">
												{t("gatewayTabKeys")}
												<Tabs.Indicator />
											</Tabs.Tab>
											<Tabs.Tab id="usage">
												{t("gatewayTabUsage")}
												<Tabs.Indicator />
											</Tabs.Tab>
										</Tabs.List>
									</Tabs.ListContainer>
									<Tabs.Panel id="accounts">
										<GatewayAccountsPanel
											instance={instance}
											instances={instances}
										/>
									</Tabs.Panel>
									<Tabs.Panel id="keys">
										<GatewayApiKeysPanel
											instanceId={instance.id}
										/>
									</Tabs.Panel>
									<Tabs.Panel id="usage">
										<GatewayUsagePanel
											instanceId={instance.id}
										/>
									</Tabs.Panel>
								</Tabs>
							) : (
								<GatewayNotRunningNotice />
							))}
					</Drawer.Body>
				</Drawer.Dialog>
			</Drawer.Content>
		</Drawer.Backdrop>
	);
}
