import { Avatar } from "@heroui/react";

// Import all agent icons as raw SVG strings
const iconModules = import.meta.glob<{ default: string }>(
	"../assets/agent/*.svg",
	{
		eager: true,
		query: "?raw",
	},
);

interface AgentIconProps {
	id: string;
	name: string;
}

export function AgentIcon({ id, name }: AgentIconProps) {
	const iconPath = `../assets/agent/${id}.svg`;
	const svg = iconModules[iconPath];
	const fallbackText = name.charAt(0).toUpperCase();

	if (svg) {
		// Render SVG inside a square container with border
		return (
			<div
				className="size-12 flex items-center justify-center rounded-lg bg-surface-secondary border border-border [&_svg]:size-8"
				dangerouslySetInnerHTML={{ __html: svg.default || svg }}
			/>
		);
	}

	// Fallback: Avatar with first letter (square with border)
	return (
		<Avatar size="lg" variant="soft" className="rounded-lg border border-border">
			<Avatar.Fallback className="rounded-lg">{fallbackText}</Avatar.Fallback>
		</Avatar>
	);
}