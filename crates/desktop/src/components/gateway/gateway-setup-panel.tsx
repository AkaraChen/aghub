import { ServerStackIcon } from "@heroicons/react/24/outline";
import { Button, Spinner } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useGatewayLaunch } from "../../hooks/use-gateway-launch";
import { CreateExternalGatewayDialog } from "./create-external-dialog";
import { gatewayLaunchLabel } from "./gateway-helpers";

interface GatewaySetupPanelProps {
	/** Called with the instance to select once it exists (installed or connected). */
	onInstanceReady: (instanceId: string) => void;
}

export function GatewaySetupPanel({ onInstanceReady }: GatewaySetupPanelProps) {
	const { t } = useTranslation();
	const [isConnectOpen, setIsConnectOpen] = useState(false);
	const launch = useGatewayLaunch();

	return (
		<div className="flex h-full items-center justify-center p-6">
			<div className="flex max-w-xs flex-col items-center gap-3 text-center">
				<ServerStackIcon className="size-[26px] text-muted" />
				<div className="flex flex-col gap-1">
					<h2 className="text-sm font-semibold text-foreground">
						{t("gatewayLocalGateway")}
					</h2>
					<p className="text-xs text-muted">
						{t("gatewayValueProp")}
					</p>
				</div>
				<div className="mt-1 flex items-center gap-2">
					<Button
						size="sm"
						isPending={launch.isPending}
						onPress={() =>
							launch.launch(
								{ start: true },
								{
									onSuccess: (instance) =>
										onInstanceReady(instance.id),
								},
							)
						}
					>
						{({ isPending }) => (
							<>
								{isPending && (
									<Spinner color="current" size="sm" />
								)}
								{isPending
									? gatewayLaunchLabel(
											t,
											launch.stage,
											launch.progress,
										)
									: t("gatewayInstallAndStart")}
							</>
						)}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						onPress={() => setIsConnectOpen(true)}
					>
						{t("gatewayAddExternal")}
					</Button>
				</div>
				<p className="text-[11px] text-muted">
					{t("gatewaySetupFinePrint")}
				</p>
			</div>

			<CreateExternalGatewayDialog
				isOpen={isConnectOpen}
				onClose={() => setIsConnectOpen(false)}
				onCreated={(instance) => onInstanceReady(instance.id)}
			/>
		</div>
	);
}
