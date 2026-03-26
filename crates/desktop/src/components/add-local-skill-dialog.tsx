import { DocumentIcon, FolderOpenIcon } from "@heroicons/react/24/outline";
import {
	Button,
	Description,
	Fieldset,
	Form,
	Input,
	Label,
	Modal,
	Tabs,
	TextArea,
	TextField,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useServer } from "../hooks/use-server";
import { createApi } from "../lib/api";
import type { CreateSkillRequest, ImportSkillRequest } from "../lib/api-types";
import { AgentSelector } from "./agent-selector";

interface AddLocalSkillDialogProps {
	isOpen: boolean;
	onClose: () => void;
	projectPath?: string;
}

export function AddLocalSkillDialog({
	isOpen,
	onClose,
	projectPath,
}: AddLocalSkillDialogProps) {
	const { t } = useTranslation();
	const { baseUrl } = useServer();
	const api = createApi(baseUrl);
	const queryClient = useQueryClient();
	const { availableAgents } = useAgentAvailability();

	const skillAgents = useMemo(
		() =>
			availableAgents.filter(
				(a) => a.isUsable && a.capabilities.skills_mutable,
			),
		[availableAgents],
	);

	const [mode, setMode] = useState<"create" | "import">("create");

	// Create state
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [author, setAuthor] = useState("");
	const [toolsInput, setToolsInput] = useState("");
	const [createAgents, setCreateAgents] = useState<Set<string>>(() => {
		return new Set(skillAgents[0] ? [skillAgents[0].id] : []);
	});

	// Import state
	const [importPath, setImportPath] = useState("");
	const [importAgents, setImportAgents] = useState<Set<string>>(() => {
		return new Set(skillAgents[0] ? [skillAgents[0].id] : []);
	});

	const [error, setError] = useState<string | null>(null);

	const invalidateCache = () => {
		queryClient.invalidateQueries({ queryKey: ["skills"] });
		queryClient.invalidateQueries({ queryKey: ["project-skills"] });
		queryClient.invalidateQueries({ queryKey: ["skill-locks"] });
	};

	const createMutation = useMutation({
		onError: (error) => {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			setError(errorMessage);
		},
		mutationFn: ({
			agent,
			body,
		}: {
			agent: string;
			body: CreateSkillRequest;
		}) => {
			return api.skills.create(agent, body, projectPath);
		},
		onSuccess: invalidateCache,
	});

	const importMutation = useMutation({
		onError: (error) => {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			setError(errorMessage);
		},
		mutationFn: ({
			agent,
			body,
		}: {
			agent: string;
			body: ImportSkillRequest;
		}) => {
			return api.skills.import(agent, body, projectPath);
		},
		onSuccess: invalidateCache,
	});

	const handleCreate = async () => {
		if (!name.trim()) return;

		const tools = toolsInput
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);

		const body: CreateSkillRequest = {
			name: name.trim(),
			description: description.trim() || undefined,
			author: author.trim() || undefined,
			tools: tools.length > 0 ? tools : undefined,
		};

		const agentsToCreate = [...createAgents];
		try {
			await Promise.all(
				agentsToCreate.map((agent) =>
					createMutation.mutateAsync({ agent, body }),
				),
			);
			handleClose();
		} catch {
			// Error is handled by onError callback
		}
	};

	const handleImportClick = async () => {
		if (!importPath.trim() || importAgents.size === 0) return;

		const body: ImportSkillRequest = {
			path: importPath.trim(),
		};

		const agentsToImport = [...importAgents];
		try {
			await Promise.all(
				agentsToImport.map((agent) =>
					importMutation.mutateAsync({ agent, body }),
				),
			);
			handleClose();
		} catch {
			// Error is handled by onError callback
		}
	};

	const handleSelectFile = async () => {
		const selected = await open({
			directory: false,
			multiple: false,
			filters: [
				{
					name: "Skill Files",
					extensions: ["zip", "skill", "json", "toml", "yaml", "yml"],
				},
				{ name: "All Files", extensions: ["*"] },
			],
		});
		if (selected && !Array.isArray(selected)) {
			setImportPath(selected);
		}
	};

	const handleSelectFolder = async () => {
		const selected = await open({ directory: true, multiple: false });
		if (selected && !Array.isArray(selected)) {
			setImportPath(selected);
		}
	};

	const isCreateValid = useMemo(() => {
		if (!name.trim()) return false;
		if (createAgents.size === 0) return false;
		if (skillAgents.length === 0) return false;
		return true;
	}, [name, createAgents.size, skillAgents.length]);

	const isImportValid = useMemo(() => {
		if (!importPath.trim()) return false;
		if (importAgents.size === 0) return false;
		if (skillAgents.length === 0) return false;
		return true;
	}, [importPath, importAgents.size, skillAgents.length]);

	const handleClose = () => {
		setError(null);
		setName("");
		setDescription("");
		setAuthor("");
		setToolsInput("");
		setImportPath("");
		setMode("create");
		onClose();
	};

	const isPending = createMutation.isPending || importMutation.isPending;

	return (
		<Modal.Backdrop
			isOpen={isOpen}
			onOpenChange={(open) => {
				if (!open && !isPending) {
					handleClose();
				}
			}}
		>
			<Modal.Container>
				<Modal.Dialog className="max-w-2xl">
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>{t("addLocalSkill")}</Modal.Heading>
					</Modal.Header>

					<Modal.Body className="p-4 sm:p-6 pb-2">
						<Tabs
							selectedKey={mode}
							onSelectionChange={(k) =>
								setMode(k as "create" | "import")
							}
						>
							<div className="mb-4">
								<Tabs.ListContainer>
									<Tabs.List
										aria-label="Creation Mode"
										className="inline-flex"
									>
										<Tabs.Tab id="create">
											{t("createFromScratch")}
											<Tabs.Indicator />
										</Tabs.Tab>
										<Tabs.Tab id="import">
											{t("importFromFile")}
											<Tabs.Indicator />
										</Tabs.Tab>
									</Tabs.List>
								</Tabs.ListContainer>
							</div>

							{error && (
								<div className="mb-4 rounded-lg border border-danger/30 bg-danger-soft p-3">
									<p className="text-sm text-danger">
										{mode === "create"
											? t("createError", { error })
											: t("importError", { error })}
									</p>
								</div>
							)}

							<Tabs.Panel id="create">
								<Form className="space-y-4">
									<Fieldset>
										<Fieldset.Group>
											<TextField className="w-full">
												<Label>{t("skillName")}</Label>
												<Input
													value={name}
													onChange={(e) =>
														setName(e.target.value)
													}
													placeholder={t(
														"skillNamePlaceholder",
													)}
													variant="secondary"
												/>
											</TextField>
											<TextField className="w-full">
												<Label>
													{t("description")}
												</Label>
												<TextArea
													value={description}
													onChange={(e) =>
														setDescription(
															e.target.value,
														)
													}
													placeholder={t(
														"descriptionPlaceholder",
													)}
													className="min-h-24"
													variant="secondary"
												/>
											</TextField>
											<TextField className="w-full">
												<Label>{t("author")}</Label>
												<Input
													value={author}
													onChange={(e) =>
														setAuthor(
															e.target.value,
														)
													}
													placeholder={t(
														"authorPlaceholder",
													)}
													variant="secondary"
												/>
											</TextField>
											<TextField className="w-full">
												<Label>
													{t("requiredTools")}
												</Label>
												<Input
													value={toolsInput}
													onChange={(e) =>
														setToolsInput(
															e.target.value,
														)
													}
													placeholder={t(
														"toolsPlaceholder",
													)}
													variant="secondary"
												/>
												<Description>
													{t("csvToolsHelp")}
												</Description>
											</TextField>
										</Fieldset.Group>
									</Fieldset>

									<Fieldset>
										<Fieldset.Group>
											<AgentSelector
												agents={skillAgents}
												selectedKeys={createAgents}
												onSelectionChange={
													setCreateAgents
												}
												label={t("targetAgent")}
												emptyMessage={t(
													"noAgentsAvailable",
												)}
												emptyHelpText={t(
													"noAgentsAvailableHelp",
												)}
											/>
										</Fieldset.Group>
									</Fieldset>
								</Form>
							</Tabs.Panel>
							<Tabs.Panel id="import">
								<Form className="space-y-4">
									<Fieldset>
										<Fieldset.Group>
											<div className="flex w-full flex-col gap-2">
												<Label>
													{t("selectFileOrFolder")}
												</Label>
												<div className="flex w-full gap-2 items-center">
													<Input
														className="flex-1 min-w-0"
														value={importPath}
														readOnly
														placeholder={t(
															"selectedPath",
														)}
														variant="secondary"
													/>
													<div className="flex flex-col sm:flex-row shrink-0 gap-2">
														<Button
															variant="secondary"
															onPress={
																handleSelectFile
															}
														>
															<DocumentIcon className="size-4" />
															{t("file", {
																defaultValue:
																	"File",
															})}
														</Button>
														<Button
															variant="secondary"
															onPress={
																handleSelectFolder
															}
														>
															<FolderOpenIcon className="size-4" />
															{t("folder", {
																defaultValue:
																	"Folder",
															})}
														</Button>
													</div>
												</div>
											</div>
										</Fieldset.Group>
									</Fieldset>

									<Fieldset>
										<Fieldset.Group>
											<AgentSelector
												agents={skillAgents}
												selectedKeys={importAgents}
												onSelectionChange={
													setImportAgents
												}
												label={t("targetAgent")}
												emptyMessage={t(
													"noAgentsAvailable",
												)}
												emptyHelpText={t(
													"noAgentsAvailableHelp",
												)}
											/>
										</Fieldset.Group>
									</Fieldset>
								</Form>
							</Tabs.Panel>
						</Tabs>
					</Modal.Body>

					<Modal.Footer>
						<Button variant="outline" onPress={handleClose}>
							{t("cancel")}
						</Button>
						{mode === "create" ? (
							<Button
								onPress={handleCreate}
								isDisabled={
									!isCreateValid || createMutation.isPending
								}
							>
								{createMutation.isPending
									? t("creating")
									: t("create")}
							</Button>
						) : (
							<Button
								onPress={handleImportClick}
								isDisabled={
									!isImportValid || importMutation.isPending
								}
							>
								{importMutation.isPending
									? t("importing")
									: t("import")}
							</Button>
						)}
					</Modal.Footer>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
