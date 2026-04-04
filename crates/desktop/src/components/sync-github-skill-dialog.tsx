import { BookOpenIcon, EyeIcon, XCircleIcon } from "@heroicons/react/24/solid";

const BACKSLASH_RE = /\\/g;

import {
	Alert,
	Button,
	Checkbox,
	Chip,
	Input,
	Label,
	ListBox,
	Modal,
	Select,
	Spinner,
	TextField,
	toast,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GitScanSkillEntry } from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { CreateCredentialDialog } from "../pages/settings/components/create-credential-dialog";
import { credentialsListQueryOptions } from "../requests/credentials";
import { gitSyncSkillMutationOptions } from "../requests/skills";
import type { SkillGroup } from "./skill-detail-helpers";

interface SyncGithubSkillDialogProps {
	group: SkillGroup;
	sourceUrl: string;
	/** Relative path of the skill inside the source repo, if known. */
	skillPath: string | null;
	isOpen: boolean;
	onClose: () => void;
	projectPath?: string;
}

const ADD_TOKEN_SENTINEL = "__add_token__";

export function SyncGithubSkillDialog({
	group,
	sourceUrl,
	skillPath,
	isOpen,
	onClose,
}: SyncGithubSkillDialogProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();

	const [phase, setPhase] = useState<
		"idle" | "scanning" | "scanned" | "syncing" | "done"
	>("idle");
	const [isPrivateRepo, setIsPrivateRepo] = useState(false);
	const [credentialId, setCredentialId] = useState<string>("");
	const [isAddTokenOpen, setIsAddTokenOpen] = useState(false);
	const [sessionId, setSessionId] = useState<string>("");
	const [branches, setBranches] = useState<string[]>([]);
	const [currentBranch, setCurrentBranch] = useState<string>("");
	const [scannedSkills, setScannedSkills] = useState<GitScanSkillEntry[]>([]);
	const [scanError, setScanError] = useState<string | null>(null);
	const [syncError, setSyncError] = useState<string | null>(null);
	const [previewSkill, setPreviewSkill] = useState<GitScanSkillEntry | null>(
		null,
	);

	const { data: credentials = [] } = useQuery({
		...credentialsListQueryOptions({
			api,
			enabled: isOpen && isPrivateRepo,
		}),
	});

	// Match the current skill in the scanned results by the known skillPath.
	// Falls back to matching by skill name.
	const normalizedSkillPath = skillPath
		? skillPath.replace(BACKSLASH_RE, "/")
		: null;
	const matchedSkill =
		scannedSkills.find((s) => {
			if (normalizedSkillPath) {
				const normPath = s.path.replace(BACKSLASH_RE, "/");
				return (
					normPath === normalizedSkillPath ||
					normPath.startsWith(`${normalizedSkillPath}/`) ||
					normalizedSkillPath.startsWith(`${normPath}/`)
				);
			}
			return s.name === group.items[0].name;
		}) ?? null;

	// All filesystem paths that need to be replaced on sync.
	const sourcePaths = group.items
		.map((item) => item.source_path)
		.filter((p): p is string => Boolean(p));

	const scanMutation = useMutation({
		mutationFn: (branch?: string) =>
			api.skills.gitScan({
				url: sourceUrl,
				credential_id: credentialId || null,
				branch: branch ?? null,
				session_id: branch ? sessionId : null,
			}),
		onSuccess: (data) => {
			setScanError(null);
			setSessionId(data.session_id);
			setBranches(data.branches);
			setCurrentBranch(data.current_branch);
			setScannedSkills(data.skills);
			setPhase("scanned");
		},
		onError: (error) => {
			const msg = error instanceof Error ? error.message : String(error);
			setScanError(msg);
			setPhase("idle");
		},
	});

	const syncMutation = useMutation(
		gitSyncSkillMutationOptions({
			api,
			queryClient,
			onSuccess: () => {
				setPhase("done");
				toast.success(t("skillSyncedSuccessfully"));
				onClose();
			},
		}),
	);

	const handleScan = () => {
		setScanError(null);
		setSyncError(null);
		setPhase("scanning");
		scanMutation.mutate(undefined);
	};

	const handleBranchChange = (branch: string) => {
		if (branch === currentBranch) return;
		scanMutation.mutate(branch);
	};

	const handleSync = () => {
		if (!matchedSkill) return;
		setSyncError(null);
		setPhase("syncing");
		syncMutation.mutate(
			{
				session_id: sessionId,
				skill_path: matchedSkill.path,
				source_paths: sourcePaths,
			},
			{
				onError: (error) => {
					setSyncError(
						error instanceof Error ? error.message : String(error),
					);
					setPhase("scanned");
				},
			},
		);
	};

	const handleClose = () => {
		if (phase === "syncing") return;
		// Reset all state when closing
		setPhase("idle");
		setIsPrivateRepo(false);
		setCredentialId("");
		setSessionId("");
		setBranches([]);
		setCurrentBranch("");
		setScannedSkills([]);
		setScanError(null);
		setSyncError(null);
		onClose();
	};

	const isBranchSwitching = scanMutation.isPending && phase === "scanned";
	const isSyncing = phase === "syncing";

	return (
		<>
			<Modal.Backdrop isOpen={isOpen} onOpenChange={handleClose}>
				<Modal.Container>
					<Modal.Dialog className="w-[calc(100vw-2rem)] max-w-lg">
						<Modal.CloseTrigger isDisabled={isSyncing} />
						<Modal.Header>
							<Modal.Heading>{t("syncSkill")}</Modal.Heading>
						</Modal.Header>

						<Modal.Body className="space-y-4 p-4">
							{/* ── Source URL (read-only display) ── */}
							<TextField className="w-full" isReadOnly>
								<Label>{t("githubRepoUrl")}</Label>
								<Input
									value={sourceUrl}
									variant="secondary"
									className="font-mono text-sm"
								/>
							</TextField>

							{/* ── Private repo toggle ── */}
							<Checkbox
								variant="secondary"
								isSelected={isPrivateRepo}
								isDisabled={phase !== "idle"}
								onChange={(checked) => {
									setIsPrivateRepo(checked);
									if (!checked) setCredentialId("");
								}}
							>
								<Checkbox.Control>
									<Checkbox.Indicator />
								</Checkbox.Control>
								<Checkbox.Content>
									<Label>{t("privateRepo")}</Label>
								</Checkbox.Content>
							</Checkbox>

							{/* ── Credential selector (shown when private) ── */}
							{isPrivateRepo && (
								<Select
									className="w-full"
									variant="secondary"
									selectedKey={credentialId || undefined}
									isDisabled={phase !== "idle"}
									onSelectionChange={(key) => {
										if (key === ADD_TOKEN_SENTINEL) {
											setIsAddTokenOpen(true);
											return;
										}
										setCredentialId(String(key));
									}}
								>
									<Label>{t("selectCredential")}</Label>
									<Select.Trigger>
										<Select.Value />
										<Select.Indicator />
									</Select.Trigger>
									<Select.Popover>
										<ListBox>
											{credentials.map((cred) => (
												<ListBox.Item
													key={cred.id}
													id={cred.id}
													textValue={cred.name}
												>
													{cred.name}
													<ListBox.ItemIndicator />
												</ListBox.Item>
											))}
											<ListBox.Section className="mt-1 border-t border-border pt-1">
												<ListBox.Item
													id={ADD_TOKEN_SENTINEL}
													textValue={t("addToken")}
												>
													{t("addToken")}
												</ListBox.Item>
											</ListBox.Section>
										</ListBox>
									</Select.Popover>
								</Select>
							)}

							{/* ── Scan error ── */}
							{scanError && (
								<Alert status="danger">
									<Alert.Indicator />
									<Alert.Content>
										<Alert.Description>
											{scanError}
										</Alert.Description>
									</Alert.Content>
								</Alert>
							)}

							{/* ── Sync error ── */}
							{syncError && (
								<Alert status="danger">
									<Alert.Indicator />
									<Alert.Content>
										<Alert.Description>
											{syncError}
										</Alert.Description>
									</Alert.Content>
								</Alert>
							)}

							{/* ── Branch selector (post-scan) ── */}
							{phase !== "idle" &&
								phase !== "scanning" &&
								branches.length > 0 && (
									<Select
										className="w-full"
										variant="secondary"
										selectedKey={currentBranch}
										isDisabled={
											isBranchSwitching || isSyncing
										}
										onSelectionChange={(key) =>
											handleBranchChange(String(key))
										}
									>
										<Label>{t("branch")}</Label>
										<Select.Trigger>
											{isBranchSwitching ? (
												<span className="flex items-center gap-2">
													<Spinner
														size="sm"
														color="current"
													/>
													{t("switchingBranch")}
												</span>
											) : (
												<Select.Value />
											)}
											<Select.Indicator />
										</Select.Trigger>
										<Select.Popover>
											<ListBox>
												{branches.map((branch) => (
													<ListBox.Item
														key={branch}
														id={branch}
														textValue={branch}
													>
														{branch}
														<ListBox.ItemIndicator />
													</ListBox.Item>
												))}
											</ListBox>
										</Select.Popover>
									</Select>
								)}

							{/* ── Skill match result (post-scan) ── */}
							{(phase === "scanned" || isSyncing) && (
								<>
									{matchedSkill ? (
										<div>
											<p className="mb-2 text-xs font-medium text-muted uppercase tracking-wide">
												{t("skillFoundInRepo")}
											</p>
											<button
												type="button"
												onClick={() =>
													setPreviewSkill(
														matchedSkill,
													)
												}
												className="flex w-full items-start gap-3 rounded-lg border border-accent/30 bg-accent/5 p-3 text-left transition-colors hover:bg-accent/10"
											>
												<BookOpenIcon className="mt-0.5 size-4 shrink-0 text-accent" />
												<div className="min-w-0 flex-1">
													<div className="flex flex-wrap items-center gap-2">
														<span className="font-medium text-foreground">
															{matchedSkill.name}
														</span>
														{matchedSkill.version && (
															<Chip
																size="sm"
																variant="secondary"
															>
																v
																{
																	matchedSkill.version
																}
															</Chip>
														)}
														{matchedSkill.author && (
															<Chip
																size="sm"
																variant="secondary"
															>
																{
																	matchedSkill.author
																}
															</Chip>
														)}
													</div>
													{matchedSkill.description && (
														<p className="mt-1 text-sm text-muted">
															{
																matchedSkill.description
															}
														</p>
													)}
												</div>
												<EyeIcon className="mt-0.5 size-4 shrink-0 text-muted" />
											</button>
										</div>
									) : (
										<div className="flex items-center gap-2 rounded-lg border border-border p-3">
											<XCircleIcon className="size-4 shrink-0 text-warning" />
											<p className="text-sm text-muted">
												{t("skillNotFoundInRepo")}
											</p>
										</div>
									)}
								</>
							)}

							{/* ── Scanning spinner ── */}
							{phase === "scanning" && (
								<div className="flex items-center justify-center gap-3 py-4">
									<Spinner size="md" />
									<p className="text-sm text-muted">
										{t("scanningRepo")}
									</p>
								</div>
							)}
						</Modal.Body>

						<Modal.Footer>
							<Button
								variant="secondary"
								onPress={handleClose}
								isDisabled={isSyncing}
							>
								{t("cancel")}
							</Button>

							{phase === "idle" ? (
								<Button
									onPress={handleScan}
									isDisabled={
										scanMutation.isPending ||
										(isPrivateRepo && !credentialId)
									}
								>
									{t("scanRepo")}
								</Button>
							) : (
								<Button
									onPress={handleSync}
									isDisabled={
										!matchedSkill ||
										isSyncing ||
										isBranchSwitching
									}
								>
									{isSyncing ? (
										<span className="flex items-center gap-2">
											<Spinner
												size="sm"
												color="current"
											/>
											{t("syncingSkill")}
										</span>
									) : (
										t("confirm")
									)}
								</Button>
							)}
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>

			{/* ── Skill Preview Modal ── */}
			<Modal.Backdrop
				isOpen={previewSkill !== null}
				onOpenChange={(open) => {
					if (!open) setPreviewSkill(null);
				}}
			>
				<Modal.Container>
					<Modal.Dialog className="w-[calc(100vw-2rem)] max-w-md">
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading>
								{previewSkill?.name ?? ""}
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="space-y-3 p-4">
							{previewSkill?.description && (
								<div>
									<p className="mb-1 text-xs font-medium text-muted uppercase tracking-wide">
										{t("description")}
									</p>
									<p className="text-sm text-foreground">
										{previewSkill.description}
									</p>
								</div>
							)}
							{previewSkill?.version && (
								<div>
									<p className="mb-1 text-xs font-medium text-muted uppercase tracking-wide">
										{t("version")}
									</p>
									<p className="text-sm text-foreground">
										{previewSkill.version}
									</p>
								</div>
							)}
							{previewSkill?.author && (
								<div>
									<p className="mb-1 text-xs font-medium text-muted uppercase tracking-wide">
										{t("author")}
									</p>
									<p className="text-sm text-foreground">
										{previewSkill.author}
									</p>
								</div>
							)}
							{previewSkill?.path && (
								<div>
									<p className="mb-1 text-xs font-medium text-muted uppercase tracking-wide">
										{t("source")}
									</p>
									<p className="break-all font-mono text-xs text-muted">
										{previewSkill.path}
									</p>
								</div>
							)}
						</Modal.Body>
						<Modal.Footer>
							<Button
								variant="secondary"
								onPress={() => setPreviewSkill(null)}
							>
								{t("cancel")}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>

			<CreateCredentialDialog
				isOpen={isAddTokenOpen}
				onClose={() => setIsAddTokenOpen(false)}
				onSuccess={(newId) => {
					if (newId) setCredentialId(newId);
				}}
			/>
		</>
	);
}
