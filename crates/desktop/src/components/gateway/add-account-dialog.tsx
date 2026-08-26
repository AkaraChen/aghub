import { ClipboardDocumentIcon } from "@heroicons/react/24/solid";
import {
	Button,
	Label,
	ListBox,
	Modal,
	Select,
	Spinner,
	toast,
} from "@heroui/react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GatewayOauthProvider } from "../../generated/dto";
import {
	type GatewayOauthAuthInfo,
	useGatewayOauth,
} from "../../hooks/use-gateway-oauth";
import { GATEWAY_OAUTH_PROVIDER_OPTIONS } from "./gateway-helpers";
import { UpstreamProviderIcon } from "./upstream-provider-icon";

function formatCountdown(remainingMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function DeviceCodeWaiting({ authInfo }: { authInfo: GatewayOauthAuthInfo }) {
	const { t } = useTranslation();
	// Ticking clock for the expiry countdown — a real external time source,
	// not derived state.
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(timer);
	}, []);

	const handleCopy = async () => {
		if (!authInfo.userCode) return;
		try {
			await writeText(authInfo.userCode);
			toast.success(t("gatewayDeviceCodeCopied"));
		} catch (error) {
			console.error("Failed to copy device code:", error);
			toast.danger(
				error instanceof Error
					? error.message
					: t("gatewayDeviceCodeCopyFailed"),
			);
		}
	};

	return (
		<div className="flex flex-col items-center gap-3 py-4 text-center">
			<p className="text-sm text-muted">{t("gatewayDeviceCodeHint")}</p>
			<div className="flex items-center gap-2">
				<span className="rounded-lg bg-surface-secondary px-4 py-2 font-mono text-2xl tracking-widest text-foreground select-all">
					{authInfo.userCode}
				</span>
				<Button
					isIconOnly
					variant="secondary"
					size="sm"
					aria-label={t("gatewayDeviceCodeCopy")}
					onPress={handleCopy}
				>
					<ClipboardDocumentIcon className="size-4" />
				</Button>
			</div>
			{authInfo.expiresAt != null && (
				<p className="text-xs text-muted tabular-nums">
					{t("gatewayDeviceCodeExpiresIn", {
						time: formatCountdown(authInfo.expiresAt - now),
					})}
				</p>
			)}
			<div className="flex items-center gap-2 text-sm text-muted">
				<Spinner color="current" size="sm" />
				{t("gatewayOauthWaiting")}
			</div>
		</div>
	);
}

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

	const isDeviceFlow =
		oauth.authInfo?.flow === "device" && oauth.authInfo.userCode !== null;

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
							isDeviceFlow && oauth.authInfo ? (
								<DeviceCodeWaiting authInfo={oauth.authInfo} />
							) : (
								<div className="flex flex-col items-center gap-3 py-6 text-center">
									<Spinner />
									<p className="text-sm text-muted">
										{t("gatewayOauthWaiting")}
									</p>
								</div>
							)
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
										{selectedOption && (
											<span className="flex items-center gap-2">
												<UpstreamProviderIcon
													logo={selectedOption.logo}
												/>
												{selectedOption.label}
											</span>
										)}
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
													<span className="flex items-center gap-2">
														<UpstreamProviderIcon
															logo={option.logo}
														/>
														{option.label}
													</span>
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
