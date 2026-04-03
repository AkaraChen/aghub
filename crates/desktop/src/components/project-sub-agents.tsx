import {
CpuChipIcon,
PencilIcon,
PlusIcon,
TrashIcon,
} from "@heroicons/react/24/solid";
import {
Button,
Input,
Label,
Surface,
TextArea,
TextField,
toast,
} from "@heroui/react";
import {
useMutation,
useQueryClient,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SubAgentResponse } from "../generated/dto";
import { useAgentAvailability } from "../hooks/use-agent-availability";
import { useApi } from "../hooks/use-api";
import {
supportsSubAgent,
supportsSubAgentScope,
} from "../lib/agent-capabilities";
import {
createSubAgentMutationOptions,
deleteSubAgentMutationOptions,
updateSubAgentMutationOptions,
} from "../requests/sub-agents";

type PanelMode = "create" | "edit" | null;

interface ProjectSubAgentsProps {
subAgents: SubAgentResponse[];
projectPath: string;
onRefresh: () => void;
isRefreshing: boolean;
}

export function ProjectSubAgents({
subAgents,
projectPath,
}: ProjectSubAgentsProps) {
const { t } = useTranslation();
const api = useApi();
const queryClient = useQueryClient();
const { availableAgents } = useAgentAvailability();

const [panelMode, setPanelMode] = useState<PanelMode>(null);
const [selected, setSelected] = useState<SubAgentResponse | null>(null);
const [editTarget, setEditTarget] = useState<SubAgentResponse | null>(
null,
);

const subAgentCapableAgents = useMemo(
() =>
availableAgents.filter(
(a) =>
a.isUsable &&
supportsSubAgent(a) &&
supportsSubAgentScope(a, "project"),
),
[availableAgents],
);

const createMutation = useMutation({
	...createSubAgentMutationOptions({
		api,
		queryClient,
		onSuccess: () => {
			toast.success(t("subAgentCreated"));
			setPanelMode(null);
		},
	}),
	onError: (error) => {
		toast.danger(
			error instanceof Error ? error.message : t("createSubAgentError"),
		);
	},
});

const updateMutation = useMutation({
	...updateSubAgentMutationOptions({
		api,
		queryClient,
		onSuccess: (data) => {
			toast.success(t("subAgentUpdated"));
			setSelected(data);
			setPanelMode(null);
		},
	}),
	onError: (error) => {
		toast.danger(
			error instanceof Error ? error.message : t("updateSubAgentError"),
		);
	},
});

const deleteMutation = useMutation({
	...deleteSubAgentMutationOptions({
		api,
		queryClient,
		onSuccess: () => {
			toast.success(t("subAgentDeleted"));
			setSelected(null);
		},
	}),
	onError: (error) => {
		toast.danger(
			error instanceof Error ? error.message : t("deleteSubAgentError"),
		);
	},
});

if (subAgents.length === 0 && !panelMode) {
return null;
}

return (
<div className="border-t border-border">
<div className="flex items-center justify-between px-4 py-3">
<h3 className="text-sm font-medium">{t("subAgents")}</h3>
<Button
isIconOnly
variant="ghost"
size="sm"
onPress={() => {
setPanelMode("create");
setSelected(null);
}}
aria-label={t("createSubAgent")}
>
<PlusIcon className="size-4" />
</Button>
</div>

{subAgents.length > 0 && (
<ul className="px-2 pb-2">
{subAgents.map((agent) => (
<li key={`${agent.agent}:${agent.name}`}>
<button
type="button"
onClick={() => {
setSelected(agent);
setPanelMode(null);
}}
className={`
w-full rounded-md px-3 py-2 text-left
text-sm transition-colors
${
selected?.name === agent.name &&
selected?.agent === agent.agent
? "bg-surface font-medium"
: "text-foreground hover:bg-surface-secondary"
}
`}
>
<div className="flex items-center justify-between gap-2">
<div className="flex items-center gap-2">
<CpuChipIcon className="size-3.5 shrink-0 text-muted" />
<span className="truncate">
{agent.name}
</span>
</div>
{agent.agent && (
<span className="shrink-0 rounded-full bg-surface-secondary px-1.5 py-0.5 text-xs text-muted">
{agent.agent}
</span>
)}
</div>
{agent.description && (
<p className="mt-0.5 truncate pl-5 text-xs text-muted">
{agent.description}
</p>
)}
</button>
</li>
))}
</ul>
)}

{selected && !panelMode && (
<SubAgentInlineDetail
agent={selected}
onEdit={() => {
setEditTarget(selected);
setPanelMode("edit");
}}
onDelete={() => {
if (!selected.agent) return;
deleteMutation.mutate({
name: selected.name,
agent: selected.agent,
scope: "project",
projectRoot: projectPath,
});
}}
isDeleting={deleteMutation.isPending}
/>
)}

{panelMode === "create" && (
<div className="px-4 pb-4">
<SubAgentInlineForm
agents={subAgentCapableAgents.map((a) => ({
id: a.id,
name: a.display_name,
}))}
onSubmit={({
agentId,
name,
description,
instruction,
}) =>
createMutation.mutate({
agent: agentId,
scope: "project",
projectRoot: projectPath,
body: {
name,
description: description || null,
instruction: instruction || null,
},
})
}
isLoading={createMutation.isPending}
onCancel={() => setPanelMode(null)}
/>
</div>
)}

{panelMode === "edit" && editTarget && (
<div className="px-4 pb-4">
<SubAgentInlineEditForm
agent={editTarget}
onSubmit={(body) => {
if (!editTarget.agent) return;
updateMutation.mutate({
name: editTarget.name,
agent: editTarget.agent,
scope: "project",
projectRoot: projectPath,
body,
});
}}
isLoading={updateMutation.isPending}
onCancel={() => setPanelMode(null)}
/>
</div>
)}
</div>
);
}

function SubAgentInlineDetail({
agent,
onEdit,
onDelete,
isDeleting,
}: {
agent: SubAgentResponse;
onEdit: () => void;
onDelete: () => void;
isDeleting: boolean;
}) {
return (
<div className="mx-2 mb-3 rounded-lg border border-border p-3">
<div className="flex items-center justify-between gap-2">
<span className="text-sm font-medium">{agent.name}</span>
<div className="flex gap-1">
<Button
isIconOnly
variant="ghost"
size="sm"
onPress={onEdit}
>
<PencilIcon className="size-3.5" />
</Button>
<Button
isIconOnly
variant="ghost"
size="sm"
isDisabled={isDeleting}
onPress={onDelete}
>
<TrashIcon className="size-3.5 text-danger" />
</Button>
</div>
</div>
{agent.description && (
<p className="mt-1 text-xs text-muted">{agent.description}</p>
)}
{agent.instruction && (
<Surface
variant="secondary"
className="mt-2 rounded p-2 font-mono text-xs whitespace-pre-wrap"
>
{agent.instruction.length > 200
? `${agent.instruction.slice(0, 200)}…`
: agent.instruction}
</Surface>
)}
</div>
);
}

interface InlineCreateValues {
agentId: string;
name: string;
description?: string;
instruction?: string;
}

function SubAgentInlineForm({
agents,
onSubmit,
isLoading,
onCancel,
}: {
agents: { id: string; name: string }[];
onSubmit: (v: InlineCreateValues) => void;
isLoading: boolean;
onCancel: () => void;
}) {
const { t } = useTranslation();
const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
const [name, setName] = useState("");
const [description, setDescription] = useState("");
const [instruction, setInstruction] = useState("");

const canSubmit = agentId && name.trim().length > 0;

return (
<div className="flex flex-col gap-3 rounded-lg border border-border p-3">
<h4 className="text-sm font-medium">{t("createSubAgent")}</h4>

{agents.length > 0 && (
<div className="flex flex-col gap-1">
<span className="text-xs font-medium text-muted">
Agent
</span>
<select
value={agentId}
onChange={(e) => setAgentId(e.target.value)}
className="
rounded border border-border bg-background
px-2 py-1.5 text-sm outline-none
focus:outline-none
"
>
{agents.map((a) => (
<option key={a.id} value={a.id}>
{a.name}
</option>
))}
</select>
</div>
)}

<TextField variant="secondary" isRequired>
<Label>{t("subAgentName")}</Label>
<Input
value={name}
onChange={(e) => setName(e.target.value)}
placeholder={t("subAgentNamePlaceholder")}
variant="secondary"
/>
</TextField>

<TextField variant="secondary">
<Label>{t("subAgentDescription")}</Label>
<Input
value={description}
onChange={(e) => setDescription(e.target.value)}
placeholder={t("subAgentDescriptionPlaceholder")}
variant="secondary"
/>
</TextField>

<TextField variant="secondary">
<Label>{t("subAgentInstruction")}</Label>
<TextArea
value={instruction}
onChange={(e) => setInstruction(e.target.value)}
placeholder={t("subAgentInstructionPlaceholder")}
className="min-h-24"
variant="secondary"
/>
</TextField>

<div className="flex gap-2">
<Button
size="sm"
isDisabled={!canSubmit || isLoading}
onPress={() =>
onSubmit({
agentId,
name: name.trim(),
description: description.trim() || undefined,
instruction: instruction.trim() || undefined,
})
}
>
{t("createSubAgent")}
</Button>
<Button variant="ghost" size="sm" onPress={onCancel}>
{t("cancel")}
</Button>
</div>
</div>
);
}

function SubAgentInlineEditForm({
agent: initial,
onSubmit,
isLoading,
onCancel,
}: {
agent: SubAgentResponse;
onSubmit: (v: {
name: string | null;
description: string | null;
instruction: string | null;
}) => void;
isLoading: boolean;
onCancel: () => void;
}) {
const { t } = useTranslation();
const [name, setName] = useState(initial.name);
const [description, setDescription] = useState(
initial.description ?? "",
);
const [instruction, setInstruction] = useState(
initial.instruction ?? "",
);

return (
<div className="flex flex-col gap-3 rounded-lg border border-border p-3">
<h4 className="text-sm font-medium">{t("editSubAgent")}</h4>

<TextField variant="secondary" isRequired>
<Label>{t("subAgentName")}</Label>
<Input
value={name}
onChange={(e) => setName(e.target.value)}
variant="secondary"
/>
</TextField>

<TextField variant="secondary">
<Label>{t("subAgentDescription")}</Label>
<Input
value={description}
onChange={(e) => setDescription(e.target.value)}
placeholder={t("subAgentDescriptionPlaceholder")}
variant="secondary"
/>
</TextField>

<TextField variant="secondary">
<Label>{t("subAgentInstruction")}</Label>
<TextArea
value={instruction}
onChange={(e) => setInstruction(e.target.value)}
placeholder={t("subAgentInstructionPlaceholder")}
className="min-h-24"
variant="secondary"
/>
</TextField>

<div className="flex gap-2">
<Button
size="sm"
isDisabled={isLoading}
onPress={() =>
onSubmit({
name: name || null,
description: description || null,
instruction: instruction || null,
})
}
>
{t("save")}
</Button>
<Button variant="ghost" size="sm" onPress={onCancel}>
{t("cancel")}
</Button>
</div>
</div>
);
}
