import { ArrowUturnLeftIcon } from "@heroicons/react/24/solid";
import { Button, Modal, Spinner } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { RuleVersionResponse } from "../../generated/dto";
import { useApi } from "../../hooks/use-api";
import { ruleVersionsQueryOptions } from "../../requests/rules";

interface RuleVersionDialogProps {
	path: string;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onRestore: (version: RuleVersionResponse) => void;
}

export function RuleVersionDialog({
	path,
	isOpen,
	onOpenChange,
	onRestore,
}: RuleVersionDialogProps) {
	const { t, i18n } = useTranslation();
	const api = useApi();
	const { data: versions = [], isPending } = useQuery(
		ruleVersionsQueryOptions({ api, path, enabled: isOpen }),
	);
	const dateTime = new Intl.DateTimeFormat(i18n.language, {
		dateStyle: "medium",
		timeStyle: "short",
	});

	return (
		<Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Container size="lg">
				<Modal.Dialog>
					<Modal.CloseTrigger />
					<Modal.Header>
						<Modal.Heading>
							{t("rulesVersionHistory")}
						</Modal.Heading>
					</Modal.Header>
					<Modal.Body className="min-h-48">
						{isPending ? (
							<div className="flex min-h-40 items-center justify-center">
								<Spinner />
							</div>
						) : versions.length === 0 ? (
							<p className="py-10 text-center text-sm text-muted">
								{t("rulesNoVersions")}
							</p>
						) : (
							<ul className="space-y-2">
								{versions.map((version) => (
									<li
										key={version.revision}
										className="rounded-xl bg-surface-secondary p-3"
									>
										<div className="mb-2 flex items-center justify-between gap-3">
											<time className="text-xs text-muted">
												{dateTime.format(
													version.created_at,
												)}
											</time>
											<Button
												size="sm"
												variant="ghost"
												onPress={() =>
													onRestore(version)
												}
											>
												<ArrowUturnLeftIcon className="size-4" />
												{t("rulesRestoreVersion")}
											</Button>
										</div>
										<pre className="max-h-36 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap text-foreground">
											{version.content}
										</pre>
									</li>
								))}
							</ul>
						)}
					</Modal.Body>
				</Modal.Dialog>
			</Modal.Container>
		</Modal.Backdrop>
	);
}
