import { CircleStackIcon, PlusIcon } from "@heroicons/react/24/solid";
import {
	Button,
	Form,
	Input,
	Label,
	Modal,
	Spinner,
	TextField,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../../hooks/use-api";
import {
	addMarketplaceMutationOptions,
	marketplaceListQueryOptions,
	removeMarketplaceMutationOptions,
	updateMarketplaceOneMutationOptions,
} from "../../requests/plugins";
import { Empty, EmptyHeader, EmptyTitle } from "../ui/empty";
import { MarketplaceSourcesTable } from "./marketplace-sources-table";

export function MarketplacesPanel({
	installScope,
	isDisabled,
}: {
	installScope: "global" | "project" | "local";
	isDisabled: boolean;
}) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const [isOpen, setIsOpen] = useState(false);
	const [source, setSource] = useState("");
	const errorMessage = (value: unknown) =>
		value instanceof Error ? value.message : t("unknownError");
	const { data, isLoading, isError, error, refetch } = useQuery(
		marketplaceListQueryOptions({ api, enabled: isOpen }),
	);
	const addMutation = useMutation({
		...addMarketplaceMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				setSource("");
				toast.success(t("marketplaceAdded"));
			},
		}),
		onError: (error) =>
			toast.danger(t("marketplaceAddFailed"), {
				description: errorMessage(error),
			}),
	});
	const removeMutation = useMutation({
		...removeMarketplaceMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("marketplaceRemoved"));
			},
		}),
		onError: (error) =>
			toast.danger(t("marketplaceRemoveFailed"), {
				description: errorMessage(error),
			}),
	});
	const updateMutation = useMutation({
		...updateMarketplaceOneMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				toast.success(t("marketplaceUpdated"));
			},
		}),
		onError: (error) =>
			toast.danger(t("marketplaceUpdateFailed"), {
				description: errorMessage(error),
			}),
	});
	const isPending =
		addMutation.isPending ||
		removeMutation.isPending ||
		updateMutation.isPending;
	const marketplaces = data?.marketplaces ?? [];

	return (
		<Modal isOpen={isOpen} onOpenChange={setIsOpen}>
			<Button variant="secondary" isDisabled={isDisabled}>
				<CircleStackIcon className="size-4" />
				{t("manageMarketplaceSources")}
			</Button>
			<Modal.Backdrop
				isDismissable={!isPending}
				isKeyboardDismissDisabled={isPending}
			>
				<Modal.Container size="lg">
					<Modal.Dialog className="sm:max-w-3xl">
						<Modal.CloseTrigger
							isDisabled={isPending}
							aria-label={t("menu.close")}
						/>
						<Modal.Header>
							<Modal.Heading>
								{t("marketplaceSources")}
							</Modal.Heading>
							<p className="text-sm text-muted">
								{t("marketplaceSourcesDescription")}
							</p>
						</Modal.Header>
						<Modal.Body className="flex flex-col gap-4">
							<Form
								className="flex items-end gap-2"
								onSubmit={(event) => {
									event.preventDefault();
									if (source.trim() && !isPending)
										addMutation.mutate({
											source: source.trim(),
											scope: installScope,
											sparse: [],
										});
								}}
							>
								<TextField
									variant="secondary"
									value={source}
									onChange={setSource}
									isDisabled={isPending}
									className="min-w-0 flex-1"
								>
									<Label>{t("source")}</Label>
									<Input
										placeholder={t(
											"marketplaceSourcePlaceholder",
										)}
									/>
								</TextField>
								<Button
									type="submit"
									isPending={addMutation.isPending}
									isDisabled={!source.trim() || isPending}
								>
									<PlusIcon className="size-4" />
									{t("marketplaceAddSource")}
								</Button>
							</Form>
							{isLoading ? (
								<div className="flex justify-center py-12">
									<Spinner />
								</div>
							) : isError ? (
								<Empty className="border-0">
									<EmptyHeader>
										<EmptyTitle className="text-sm [overflow-wrap:anywhere]">
											{errorMessage(error)}
										</EmptyTitle>
									</EmptyHeader>
									<Button
										variant="secondary"
										onPress={() => refetch()}
									>
										{t("retry")}
									</Button>
								</Empty>
							) : marketplaces.length === 0 ? (
								<Empty className="border-0">
									<EmptyHeader>
										<EmptyTitle className="text-sm text-muted">
											{t("marketplaceNoneTitle")}
										</EmptyTitle>
									</EmptyHeader>
								</Empty>
							) : (
								<MarketplaceSourcesTable
									marketplaces={marketplaces}
									isPending={isPending}
									removingName={
										removeMutation.isPending
											? removeMutation.variables
											: undefined
									}
									updatingName={
										updateMutation.isPending
											? updateMutation.variables
											: undefined
									}
									onRemove={(name) =>
										removeMutation.mutate(name)
									}
									onUpdate={(name) =>
										updateMutation.mutate(name)
									}
								/>
							)}
						</Modal.Body>
						<Modal.Footer>
							<Button
								variant="secondary"
								isDisabled={isPending}
								onPress={() => setIsOpen(false)}
							>
								{t("menu.close")}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
