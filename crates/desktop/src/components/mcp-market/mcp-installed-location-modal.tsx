import { Button, Modal } from "@heroui/react";
import { useTranslation } from "react-i18next";
import type { MarketMcpInstalledLocation } from "../../lib/mcp-market-inventory";
import { formatAgentName } from "../../lib/utils";

interface McpInstalledLocationModalProps {
	isOpen: boolean;
	locations: MarketMcpInstalledLocation[];
	onSelect: (location: MarketMcpInstalledLocation) => void;
	onClose: () => void;
}

export function McpInstalledLocationModal({
	isOpen,
	locations,
	onSelect,
	onClose,
}: McpInstalledLocationModalProps) {
	const { t } = useTranslation();

	return (
		<Modal.Backdrop
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Modal.Container>
				<Modal.Dialog className="max-w-md">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>
							{t("marketMcpChooseLocation")}
						</Modal.Heading>
					</Modal.Header>
					<Modal.Body className="space-y-2 p-2">
						{locations.map((location) => (
							<Button
								key={location.id}
								variant="secondary"
								className="h-auto w-full justify-between px-3 py-2"
								onPress={() => onSelect(location)}
							>
								<span className="min-w-0 text-left">
									<span className="block truncate">
										{location.target.scope === "global"
											? t("global")
											: location.target.projectName}
									</span>
									<span className="block truncate text-xs text-muted">
										{[
											...new Set(
												location.group.items.map(
													(item) => item.agent,
												),
											),
										]
											.map((agent) =>
												agent
													? formatAgentName(agent)
													: t("default"),
											)
											.join(", ")}
									</span>
								</span>
								<span className="max-w-52 shrink-0 truncate text-xs text-muted">
									{location.method.label}
								</span>
							</Button>
						))}
					</Modal.Body>
					<Modal.Footer>
						<Button slot="close" variant="secondary">
							{t("cancel")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
