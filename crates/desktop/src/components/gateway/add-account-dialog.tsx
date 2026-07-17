import { Button, Label, ListBox, Modal, Select, Spinner } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GatewayOauthProvider } from "../../generated/dto";
import { GATEWAY_OAUTH_PROVIDER_OPTIONS } from "./gateway-helpers";
import { useGatewayOauth } from "../../hooks/use-gateway-oauth";

interface AddGatewayAccountDialogProps {
	instanceId: string;
	isOpen: boolean;
	onClose: () => void;
}

export function AddGatewayAccountDialog({
	instanceId,
	isOpen,
	onClose,
}: AddGatewayAccountDialogProps) {
	const { t } = useTranslation();
	const [provider, setProvider] = useState<GatewayOauthProvider>("anthropic");

	const oauth = useGatewayOauth({ instanceId, onSuccess: onClose });

	const selectedOption = GATEWAY_OAUTH_PROVIDER_OPTIONS.find(
		(option) => option.id === provider,
	);

	const handleClose = () => {
		if (oauth.isPending) {
			oauth.cancel();
		}
		onClose();
	};

	return (
		<Modal.Backdrop
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open) handleClose();
			}}
		>
			<Modal.Container>
				<Modal.Dialog>
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("gatewayAddAccount")}</Modal.Heading>
					</Modal.Header>
					<Modal.Body className="p-2">
						{oauth.isPending ? (
							<div className="flex flex-col items-center gap-3 py-6 text-center">
								<Spinner />
								<p className="text-sm text-muted">
									{t("gatewayOauthWaiting")}
								</p>
							</div>
						) : (
							<Select
								className="w-full"
								variant="secondary"
								selectedKey={provider}
								onSelectionChange={(key) => {
									if (!key) return;
									setProvider(
										String(key) as GatewayOauthProvider,
									);
								}}
							>
								<Label>{t("gatewayOauthProviderLabel")}</Label>
								<Select.Trigger>
									<Select.Value>
										{selectedOption?.label}
									</Select.Value>
									<Select.Indicator />
								</Select.Trigger>
								<Select.Popover>
									<ListBox>
										{GATEWAY_OAUTH_PROVIDER_OPTIONS.map(
											(option) => (
												<ListBox.Item
													key={option.id}
													id={option.id}
													textValue={option.label}
												>
													{option.label}
													<ListBox.ItemIndicator />
												</ListBox.Item>
											),
										)}
									</ListBox>
								</Select.Popover>
							</Select>
						)}
					</Modal.Body>
					<Modal.Footer>
						<Button
							type="button"
							variant="secondary"
							onPress={handleClose}
						>
							{t("cancel")}
						</Button>
						{!oauth.isPending && (
							<Button onPress={() => oauth.start(provider)}>
								{t("gatewayOauthStart")}
							</Button>
						)}
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
