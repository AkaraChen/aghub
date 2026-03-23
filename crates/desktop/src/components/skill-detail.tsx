import { FolderIcon } from "@heroicons/react/24/solid";
import { Button, Chip } from "@heroui/react";
import { homeDir } from "@tauri-apps/api/path";
import { openPath } from "@tauri-apps/plugin-opener";
import { dirname } from "pathe";
import { useTranslation } from "react-i18next";
import type { SkillResponse } from "../lib/api-types";

export interface SkillGroup {
	name: string;
	items: SkillResponse[];
}

interface SkillDetailProps {
	group: SkillGroup;
	projectPath?: string;
}

export function SkillDetail({ group, projectPath: _projectPath }: SkillDetailProps) {
	const { t } = useTranslation();
	const skill = group.items[0];

	const handleOpenFolder = async () => {
		if (skill.source_path) {
			try {
				let path = skill.source_path;
				if (path.startsWith("~/")) {
					const home = await homeDir();
					// Avoid replacing all characters if malformed, safely append
					path = `${home}/${path.slice(2)}`;
				}
				const folderPath = dirname(path);
				await openPath(folderPath);
			} catch (error) {
				console.error("Failed to open folder:", error);
			}
		}
	};

	return (
		<div className="h-full overflow-y-auto">
			<div className="p-6 max-w-3xl">
				{/* Header */}
				<div className="flex items-center justify-between gap-3 mb-1">
					<h2 className="text-xl font-semibold leading-tight text-foreground truncate">
						{skill.name}
					</h2>
					{skill.source_path && (
						<Button
							isIconOnly
							variant="ghost"
							size="sm"
							className="text-muted hover:text-foreground shrink-0"
							aria-label={t("openFolder")}
							onPress={handleOpenFolder}
						>
							<FolderIcon className="size-4" />
						</Button>
					)}
				</div>
				{skill.source_path && (
					<p className="text-xs text-muted mb-6 font-mono">
						{skill.source_path}
					</p>
				)}

				{/* Description */}
				{skill.description && (
					<div className="mb-6">
						<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
							{t("description")}
						</h3>
						<p className="text-sm text-foreground">
							{skill.description}
						</p>
					</div>
				)}

				{/* Metadata */}
				{(skill.author || skill.version) && (
					<div className="mb-6 flex gap-6">
						{skill.author && (
							<div>
								<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-1">
									{t("author")}
								</h3>
								<p className="text-sm text-foreground">
									{skill.author}
								</p>
							</div>
						)}
						{skill.version && (
							<div>
								<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-1">
									{t("version")}
								</h3>
								<p className="text-sm text-foreground font-mono">
									{skill.version}
								</p>
							</div>
						)}
					</div>
				)}

				{/* Tools */}
				{skill.tools.length > 0 && (
					<div className="mb-6">
						<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
							{t("tools")} ({skill.tools.length})
						</h3>
						<div className="flex flex-wrap gap-1.5">
							{skill.tools.map((tool) => (
								<Chip key={tool} size="sm">
									{tool}
								</Chip>
							))}
						</div>
					</div>
				)}

				{/* Source scope */}
				{skill.source && (
					<div>
						<h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-1">
							{t("source")}
						</h3>
						<Chip size="sm">{skill.source}</Chip>
					</div>
				)}
			</div>
		</div>
	);
}