import { ArrowPathIcon } from "@heroicons/react/24/solid";
import { Button, Chip, Modal, Spinner, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useApi } from "../hooks/use-api";
import {
	openCodeProvidersQueryOptions,
	transferProvidersMutationOptions,
} from "../requests/inference";

interface ProviderTransferDialogProps {
	isOpen: boolean;
	onClose: () => void;
}

export function ProviderTransferDialog({
	isOpen,
	onClose,
}: ProviderTransferDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();

	const { data: providers = [], isFetching } = useQuery({
		...openCodeProvidersQueryOptions({ api, enabled: isOpen }),
	});

	const transferMutation = useMutation(
		transferProvidersMutationOptions({
			api,
			queryClient,
		}),
	);

	const handleTransfer = async () => {
		try {
			const result = await transferMutation.mutateAsync();
			toast.success(
				t("providerTransferSuccess", {
					imported: result.imported_count,
					skipped: result.skipped_count,
				}),
			);
			onClose();
		} catch (error) {
			toast.danger(
				error instanceof Error
					? error.message
					: t("providerTransferFailed"),
			);
		}
	};

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
			<Modal.Container>
				<Modal.Dialog className="w-[calc(100vw-2rem)] max-w-lg">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>
							{t("providerTransferTitle")}
						</Modal.Heading>
					</Modal.Header>
					<Modal.Body className="space-y-3">
						<p className="text-sm text-muted">
							{t("providerTransferDescription")}
						</p>
						{isFetching ? (
							<div className="py-6 flex justify-center">
								<Spinner size="sm" />
							</div>
						) : providers.length === 0 ? (
							<p className="text-sm text-muted">
								{t("providerTransferNoProviders")}
							</p>
						) : (
							<div className="max-h-72 overflow-auto space-y-2">
								{providers.map((provider) => (
									<div
										key={provider.name}
										className="rounded-lg border border-separator px-3 py-2"
									>
										<div className="flex items-center gap-2">
											<span className="text-sm font-medium text-foreground">
												{provider.name}
											</span>
											<Chip size="sm" variant="tertiary">
												{provider.type}
											</Chip>
											<Chip
												size="sm"
												variant={
													provider.has_key
														? "soft"
														: "tertiary"
												}
											>
												{provider.has_key
													? t("providerHasKey")
													: t("providerNoKey")}
											</Chip>
										</div>
										{provider.base && (
											<p className="mt-1 font-mono text-xs text-muted break-all">
												{provider.base}
											</p>
										)}
									</div>
								))}
							</div>
						)}
					</Modal.Body>
					<Modal.Footer>
						<Button variant="secondary" onPress={onClose}>
							{t("cancel")}
						</Button>
						<Button
							variant="primary"
							onPress={handleTransfer}
							isDisabled={
								providers.length === 0 ||
								transferMutation.isPending ||
								isFetching
							}
						>
							{transferMutation.isPending && (
								<ArrowPathIcon className="size-4 animate-spin" />
							)}
							{t("providerTransferAction")}
						</Button>
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
