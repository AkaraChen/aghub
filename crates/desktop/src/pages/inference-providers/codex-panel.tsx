import { Card } from "@heroui/react";
import { AgentIcon } from "../../lib/agent-icons";

export function CodexInferenceProviderPanel() {
	return (
		<div className="h-full overflow-y-auto">
			<div className="w-full p-4 sm:p-6">
				<Card>
					<Card.Header className="flex flex-row items-start justify-between gap-3">
						<div className="flex min-w-0 items-center gap-3">
							<AgentIcon
								id="codex"
								name="Codex"
								size="xs"
								variant="ghost"
							/>
							<div className="min-w-0">
								<h2 className="truncate text-xl font-semibold text-foreground">
									Codex
								</h2>
							</div>
						</div>
					</Card.Header>
					<Card.Content />
				</Card>
			</div>
		</div>
	);
}
