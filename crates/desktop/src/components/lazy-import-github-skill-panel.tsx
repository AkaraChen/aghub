import { Spinner } from "@heroui/react";
import { lazy, Suspense } from "react";
import type { ImportGithubSkillPanelProps } from "./import-github-skill-panel";

const ImportGithubSkillPanel = lazy(() =>
	import("./import-github-skill-panel").then((module) => ({
		default: module.ImportGithubSkillPanel,
	})),
);

export function LazyImportGithubSkillPanel(props: ImportGithubSkillPanelProps) {
	return (
		<Suspense
			fallback={
				<div className="flex h-full min-h-48 items-center justify-center">
					<Spinner />
				</div>
			}
		>
			<ImportGithubSkillPanel {...props} />
		</Suspense>
	);
}
