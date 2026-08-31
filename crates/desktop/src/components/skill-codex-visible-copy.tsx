import { ChevronDownIcon } from "@heroicons/react/24/solid";
import {
	Accordion,
	Button,
	Checkbox,
	CheckboxGroup,
	toast,
} from "@heroui/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CodexStandaloneSkillResponse } from "../generated/dto";
import { useApi } from "../hooks/use-api";
import { selectCodexVisibleCopyMutationOptions } from "../requests/skills";

const CODEX_VISIBLE_COPY_ID = "codex-visible-copy";

interface SkillCodexVisibleCopyProps {
	name: string;
	copies: CodexStandaloneSkillResponse[];
	projectRoot?: string;
}

export function SkillCodexVisibleCopy({
	name,
	copies,
	projectRoot,
}: SkillCodexVisibleCopyProps) {
	const { t } = useTranslation();
	const api = useApi();
	const queryClient = useQueryClient();
	const currentPaths = copies
		.filter((copy) => copy.enabled)
		.map((copy) => copy.source_path);
	const [proposedPaths, setProposedPaths] = useState<string[] | null>(null);
	const [isExpanded, setIsExpanded] = useState(copies.length > 1);
	const selectedPaths = proposedPaths ?? currentPaths;
	const selectionIsCurrent =
		selectedPaths.length === currentPaths.length &&
		selectedPaths.every((path) => currentPaths.includes(path));
	const updateVisibility = useMutation(
		selectCodexVisibleCopyMutationOptions({
			api,
			queryClient,
			projectRoot,
			onSuccess: () => {
				setProposedPaths(null);
				toast.success(t("codexVisibleCopyUpdated"));
			},
		}),
	);

	if (copies.length <= 1) return null;

	function handleSave() {
		updateVisibility.mutate(
			{ name, mode: "selected", source_paths: selectedPaths },
			{
				onError: (error) =>
					toast.danger(
						t("codexVisibleCopyUpdateFailed", {
							error:
								error instanceof Error
									? error.message
									: String(error),
						}),
					),
			},
		);
	}

	return (
		<Accordion
			variant="surface"
			expandedKeys={
				isExpanded
					? new Set([CODEX_VISIBLE_COPY_ID])
					: new Set<string>()
			}
			onExpandedChange={(keys) =>
				setIsExpanded(keys.has(CODEX_VISIBLE_COPY_ID))
			}
		>
			<Accordion.Item id={CODEX_VISIBLE_COPY_ID}>
				<Accordion.Heading>
					<Accordion.Trigger>
						<div className="min-w-0 flex-1 text-left">
							<p>{t("codexVisibleCopies")}</p>
							<p className="text-xs font-normal text-muted">
								{t("codexVisibleCopiesDescription", {
									count: currentPaths.length,
									total: copies.length,
								})}
							</p>
						</div>
						<Accordion.Indicator>
							<ChevronDownIcon className="size-4" />
						</Accordion.Indicator>
					</Accordion.Trigger>
				</Accordion.Heading>
				<Accordion.Panel>
					<Accordion.Body>
						<div className="space-y-4">
							<CheckboxGroup
								aria-label={t("codexVisibleCopies")}
								value={selectedPaths}
								onChange={setProposedPaths}
								className="grid min-w-0 gap-2"
								variant="secondary"
								isDisabled={updateVisibility.isPending}
							>
								{copies.map((copy) => (
									<Checkbox
										key={copy.source_path}
										value={copy.source_path}
										className="w-full min-w-0"
									>
										<Checkbox.Content className="w-full min-w-0 items-start gap-3 rounded-xl border border-border bg-surface-secondary/60 p-3 transition-colors data-[hovered=true]:bg-surface-secondary data-[selected=true]:border-accent/30 data-[selected=true]:bg-accent/5">
											<Checkbox.Control className="mt-0.5 shrink-0">
												<Checkbox.Indicator />
											</Checkbox.Control>
											<span className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
												{copy.source_path}
											</span>
										</Checkbox.Content>
									</Checkbox>
								))}
							</CheckboxGroup>
							<div className="flex flex-wrap items-center justify-between gap-3 border-t border-separator pt-4">
								<p className="text-xs text-muted">
									{t("codexVisibleCopyFileNotice")}
								</p>
								<Button
									variant="primary"
									isPending={updateVisibility.isPending}
									isDisabled={selectionIsCurrent}
									onPress={handleSave}
								>
									{t("save")}
								</Button>
							</div>
						</div>
					</Accordion.Body>
				</Accordion.Panel>
			</Accordion.Item>
		</Accordion>
	);
}
