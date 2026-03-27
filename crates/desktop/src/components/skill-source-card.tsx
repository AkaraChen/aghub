import { GlobeAltIcon } from "@heroicons/react/24/solid";
import { siGithub } from "simple-icons";

interface SkillSourceCardProps {
	source: string;
	className?: string;
}

const GITHUB_PREFIX_REGEX = /^github\//;

export function SkillSourceCard({
	source,
	className = "",
}: SkillSourceCardProps) {
	const isGithub = GITHUB_PREFIX_REGEX.test(source);

	return (
		<div
			className={`flex items-center gap-1.5 rounded-lg bg-surface-secondary px-3 py-2 ${className}`}
		>
			{isGithub ? (
				<svg
					role="img"
					className="size-3.5 shrink-0 text-muted"
					viewBox="0 0 24 24"
					fill="currentColor"
				>
					<path d={siGithub.path} />
				</svg>
			) : (
				<GlobeAltIcon className="size-3.5 shrink-0 text-muted" />
			)}
			<span className="min-w-0 truncate text-sm text-foreground">
				{source}
			</span>
		</div>
	);
}
