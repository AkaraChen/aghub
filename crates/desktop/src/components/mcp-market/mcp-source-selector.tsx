import { TrashIcon } from "@heroicons/react/24/solid";
import {
	Button,
	Description,
	Input,
	Label,
	ListBox,
	Modal,
	Select,
	TextField,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useApi } from "../../hooks/use-api";
import {
	addMcpRegistryMutationOptions,
	mcpRegistriesQueryOptions,
	removeMcpRegistryMutationOptions,
} from "../../requests/mcp-registries";

const OFFICIAL = "official";
const ADD_ACTION = "__add__";

function normalizeRegistryUrl(value: string): string | null {
	try {
		const url = new URL(value);
		if (!["http:", "https:"].includes(url.protocol)) return null;
		if (url.username || url.password) return null;
		return url.toString();
	} catch {
		return null;
	}
}

interface McpSourceSelectorProps {
	/** Called with the active registry URL, or null for the official registry. */
	onChange: (registryUrl: string | null) => void;
}

export function McpSourceSelector({ onChange }: McpSourceSelectorProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const { data: registries = [] } = useQuery(mcpRegistriesQueryOptions());
	const addMutation = useMutation(
		addMcpRegistryMutationOptions({ api, queryClient }),
	);
	const removeMutation = useMutation(
		removeMcpRegistryMutationOptions(queryClient),
	);

	const [selectedId, setSelectedId] = useState<string>(OFFICIAL);
	const [addOpen, setAddOpen] = useState(false);
	const [name, setName] = useState("");
	const [url, setUrl] = useState("");

	const selectedCustom = registries.find((r) => r.id === selectedId) ?? null;

	const selectSource = (id: string) => {
		const registry = registries.find((r) => r.id === id);
		setSelectedId(registry ? id : OFFICIAL);
		onChange(registry ? registry.url : null);
	};

	const handleSelectionChange = (key: string) => {
		if (key === ADD_ACTION) {
			setName("");
			setUrl("");
			setAddOpen(true);
			return;
		}
		selectSource(key);
	};

	const handleAdd = async () => {
		const trimmedName = name.trim();
		const normalizedUrl = normalizeRegistryUrl(url.trim());
		if (!trimmedName || !normalizedUrl) {
			toast.danger(t("marketMcpSourceUrlInvalid"));
			return;
		}
		try {
			const created = await addMutation.mutateAsync({
				name: trimmedName,
				url: normalizedUrl,
			});
			setAddOpen(false);
			setSelectedId(created.id);
			onChange(created.url);
		} catch (err) {
			toast.danger(err instanceof Error ? err.message : String(err));
		}
	};

	const handleRemove = async () => {
		if (!selectedCustom) return;
		try {
			await removeMutation.mutateAsync(selectedCustom.id);
			setSelectedId(OFFICIAL);
			onChange(null);
		} catch (err) {
			toast.danger(err instanceof Error ? err.message : String(err));
		}
	};

	return (
		<div className="flex shrink-0 items-center gap-1">
			<Select
				variant="secondary"
				aria-label={t("marketMcpSource")}
				selectedKey={selectedId}
				onSelectionChange={(key) => handleSelectionChange(String(key))}
				className="min-w-36 max-w-48 shrink-0"
			>
				<Select.Trigger>
					<Select.Value />
					<Select.Indicator />
				</Select.Trigger>
				<Select.Popover>
					<ListBox>
						<ListBox.Item
							id={OFFICIAL}
							textValue={t("marketMcpSourceOfficial")}
						>
							{t("marketMcpSourceOfficial")}
						</ListBox.Item>
						{registries.map((registry) => (
							<ListBox.Item
								key={registry.id}
								id={registry.id}
								textValue={registry.name}
							>
								{registry.name}
							</ListBox.Item>
						))}
						<ListBox.Item
							id={ADD_ACTION}
							textValue={t("marketMcpSourceAdd")}
						>
							{t("marketMcpSourceAdd")}
						</ListBox.Item>
					</ListBox>
				</Select.Popover>
			</Select>
			{selectedCustom && (
				<Button
					isIconOnly
					variant="ghost"
					size="sm"
					className="size-8 shrink-0 text-muted"
					aria-label={t("marketMcpSourceRemove")}
					onPress={handleRemove}
					isDisabled={removeMutation.isPending}
					isPending={removeMutation.isPending}
				>
					<TrashIcon className="size-4" />
				</Button>
			)}

			<Modal.Backdrop
				isOpen={addOpen}
				onOpenChange={(open) => {
					if (!addMutation.isPending) setAddOpen(open);
				}}
			>
				<Modal.Container>
					<Modal.Dialog className="max-w-md">
						<Modal.CloseTrigger
							isDisabled={addMutation.isPending}
						/>
						<Modal.Header>
							<Modal.Heading>
								{t("marketMcpSourceAddTitle")}
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="space-y-3 p-4">
							<TextField
								className="w-full"
								variant="secondary"
								name="registry-name"
								isRequired
							>
								<Label>{t("name")}</Label>
								<Input
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder={t(
										"marketMcpSourceNamePlaceholder",
									)}
									variant="secondary"
								/>
							</TextField>
							<TextField
								className="w-full"
								variant="secondary"
								name="registry-url"
								type="url"
								isRequired
							>
								<Label>URL</Label>
								<Input
									value={url}
									onChange={(e) => setUrl(e.target.value)}
									placeholder="https://my-registry.example.com"
									variant="secondary"
								/>
								<Description>
									{t("marketMcpSourceUrlHint")}
								</Description>
							</TextField>
						</Modal.Body>
						<Modal.Footer>
							<Button
								slot="close"
								variant="secondary"
								isDisabled={addMutation.isPending}
							>
								{t("cancel")}
							</Button>
							<Button
								onPress={handleAdd}
								isDisabled={
									!name.trim() ||
									!url.trim() ||
									addMutation.isPending
								}
								isPending={addMutation.isPending}
							>
								{t("add")}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</div>
	);
}
