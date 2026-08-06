import { Squares2X2Icon } from "@heroicons/react/24/solid";
import { cn } from "../lib/utils";

export function UniversalSkillTargetIcon({
	size = "sm",
	className,
}: {
	size?: "xs" | "sm";
	className?: string;
}) {
	return (
		<span
			data-testid="universal-skill-target-icon"
			aria-hidden="true"
			className={cn(
				"flex shrink-0 items-center justify-center text-muted",
				size === "xs" ? "size-5" : "size-8",
				className,
			)}
		>
			<Squares2X2Icon className={size === "xs" ? "size-4" : "size-5"} />
		</span>
	);
}
