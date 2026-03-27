import { GlobeAltIcon } from "@heroicons/react/24/solid";
import { siGithub } from "simple-icons";

interface SkillInfoCardProps {
	name: string;
	source: string;
	className?: string;
}

const GITHUB_PREFIX_REGEX = /^github\//;

export function SkillInfoCard({
	name,
	source,
	className = "",
}: SkillInfoCardProps) {
	const isGithub = GITHUB_PREFIX_REGEX.test(source);

	return (
		<div
			className={`flex flex-col gap-2 rounded-lg bg-surface-secondary px-3 py-2.5 ${className}`}
		>
			<span className="font-medium truncate text-foreground">{name}</span>
			<div className="flex items-center gap-1.5">
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
				<span className="min-w-0 truncate text-sm text-muted">
					{source}
				</span>
			</div>
		</div>
	);
}
