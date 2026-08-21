import type { SkillHardLinkResponse } from "../generated/dto";
import { cn } from "../lib/utils";

export function SkillHardLinkState({
	hardLink,
	className,
}: {
	hardLink: SkillHardLinkResponse;
	className?: string;
}) {
	const [first, ...rest] = hardLink.peers;
	if (!first) return null;

	return (
		<div
			data-skill-hard-link
			className={cn(
				"flex min-w-0 items-center gap-1.5 text-xs text-muted",
				className,
			)}
			title={hardLink.peers.join(", ")}
		>
			<code className="min-w-0 truncate">{first}</code>
			{rest.length > 0 && (
				<span className="shrink-0">+{rest.length}</span>
			)}
		</div>
	);
}
