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
SearchField,
Surface,
TextArea,
TextField,
toast,
} from "@heroui/react";
import {
useMutation,
useQueryClient,
useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
Empty,
EmptyHeader,
EmptyMedia,
EmptyTitle,
} from "../../components/ui/empty";
import type { SubAgentResponse } from "../../generated/dto";
import { useAgentAvailability } from "../../hooks/use-agent-availability";
import { useApi } from "../../hooks/use-api";
import { supportsSubAgent } from "../../lib/agent-capabilities";
import {
createSubAgentMutationOptions,
deleteSubAgentMutationOptions,
subAgentListQueryOptions,
updateSubAgentMutationOptions,
} from "../../requests/sub-agents";

type PanelState =
| { type: "empty" }
| { type: "create" }
| { type: "detail"; agent: SubAgentResponse }
| { type: "edit"; agent: SubAgentResponse };

export default function SubAgentsPage() {
const { t } = useTranslation();
const api = useApi();
const queryClient = useQueryClient();
const { availableAgents } = useAgentAvailability();
const [searchQuery, setSearchQuery] = useState("");
const [panel, setPanel] = useState<PanelState>({ type: "empty" });

const subAgentCapableAgents = useMemo(
() =>
availableAgents.filter((a) => a.isUsable && supportsSubAgent(a)),
[availableAgents],
);

const { data: subAgents = [] } = useSuspenseQuery({
...subAgentListQueryOptions({ api, scope: "global" }),
});

const filteredAgents = useMemo(
() =>
subAgents.filter((a) =>
a.name.toLowerCase().includes(searchQuery.toLowerCase()),
),
[subAgents, searchQuery],
);

const createMutation = useMutation({
	...createSubAgentMutationOptions({
		api,
		queryClient,
		onSuccess: (data) => {
			toast.success(t("subAgentCreated"));
			setPanel({ type: "detail", agent: data });
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
			setPanel({ type: "detail", agent: data });
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
			setPanel({ type: "empty" });
		},
	}),
	onError: (error) => {
		toast.danger(
			error instanceof Error ? error.message : t("deleteSubAgentError"),
		);
	},
});

return (
<div className="flex h-full">
{/* List panel */}
<div className="flex w-80 shrink-0 flex-col border-r border-border">
<div className="flex items-center gap-2 p-3">
<SearchField
value={searchQuery}
onChange={setSearchQuery}
aria-label={t("searchSubAgents")}
variant="secondary"
className="flex-1"
>
<SearchField.Group>
<SearchField.SearchIcon />
<SearchField.Input
placeholder={t("searchSubAgents")}
/>
<SearchField.ClearButton />
</SearchField.Group>
</SearchField>
<Button
isIconOnly
variant="ghost"
size="sm"
onPress={() => setPanel({ type: "create" })}
aria-label={t("createSubAgent")}
>
<PlusIcon className="size-4" />
</Button>
</div>

<div className="flex-1 overflow-y-auto">
{filteredAgents.length === 0 ? (
<div className="flex h-full items-center justify-center p-6">
<Empty className="border-0">
<EmptyHeader>
<EmptyMedia>
<CpuChipIcon className="size-8 text-muted" />
</EmptyMedia>
<EmptyTitle className="text-sm font-normal text-muted">
{t("noSubAgents")}
</EmptyTitle>
</EmptyHeader>
<Button
variant="outline"
size="sm"
onPress={() => setPanel({ type: "create" })}
>
<PlusIcon className="mr-1 size-4" />
{t("createSubAgent")}
</Button>
</Empty>
</div>
) : (
<ul className="flex flex-col gap-0.5 p-2">
{filteredAgents.map((agent) => {
const isSelected =
(panel.type === "detail" ||
panel.type === "edit") &&
panel.agent.name === agent.name &&
panel.agent.agent === agent.agent;
return (
<li
key={`${agent.agent}:${agent.name}`}
>
<button
type="button"
onClick={() =>
setPanel({
type: "detail",
agent,
})
}
className={`
w-full rounded-md px-3 py-2
text-left text-sm transition-colors
${
isSelected
? "bg-surface font-medium text-foreground"
: "text-foreground hover:bg-surface-secondary"
}
`}
>
<div className="flex items-center justify-between gap-2">
<span className="truncate font-medium">
{agent.name}
</span>
{agent.agent && (
<span className="shrink-0 rounded-full bg-surface-secondary px-1.5 py-0.5 text-xs text-muted">
{agent.agent}
</span>
)}
</div>
{agent.description && (
<p className="mt-0.5 truncate text-xs text-muted">
{agent.description}
</p>
)}
</button>
</li>
);
})}
</ul>
)}
</div>
</div>

{/* Detail / form panel */}
<div className="flex flex-1 overflow-hidden">
{panel.type === "empty" && (
<div className="flex flex-1 items-center justify-center">
<Empty className="border-0">
<EmptyHeader>
<EmptyMedia>
<CpuChipIcon className="size-8 text-muted" />
</EmptyMedia>
<EmptyTitle className="text-sm font-normal text-muted">
{t("noSubAgentsDescription")}
</EmptyTitle>
</EmptyHeader>
<Button
variant="outline"
size="sm"
onPress={() => setPanel({ type: "create" })}
>
<PlusIcon className="mr-1 size-4" />
{t("createSubAgent")}
</Button>
</Empty>
</div>
)}

{panel.type === "create" && (
<SubAgentCreateForm
agents={subAgentCapableAgents.map((a) => ({
id: a.id,
name: a.display_name,
}))}
onSubmit={({ agentId, name, description, instruction }) =>
createMutation.mutate({
agent: agentId,
scope: "global",
body: {
name,
description: description || null,
instruction: instruction || null,
},
})
}
isLoading={createMutation.isPending}
onCancel={() => setPanel({ type: "empty" })}
/>
)}

{panel.type === "detail" && (
<SubAgentDetail
agent={panel.agent}
onEdit={() =>
setPanel({ type: "edit", agent: panel.agent })
}
onDelete={() => {
if (!panel.agent.agent) return;
deleteMutation.mutate({
name: panel.agent.name,
agent: panel.agent.agent,
scope: "global",
});
}}
isDeleting={deleteMutation.isPending}
/>
)}

{panel.type === "edit" && (
<SubAgentEditForm
agent={panel.agent}
onSubmit={(body) => {
if (!panel.agent.agent) return;
updateMutation.mutate({
name: panel.agent.name,
agent: panel.agent.agent,
scope: "global",
body,
});
}}
isLoading={updateMutation.isPending}
onCancel={() =>
setPanel({ type: "detail", agent: panel.agent })
}
/>
)}
</div>
</div>
);
}

interface AgentOption {
id: string;
name: string;
}

interface CreateFormValues {
agentId: string;
name: string;
description?: string;
instruction?: string;
}

function SubAgentCreateForm({
agents,
onSubmit,
isLoading,
onCancel,
}: {
agents: AgentOption[];
onSubmit: (v: CreateFormValues) => void;
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
<div className="flex flex-1 flex-col overflow-y-auto p-6">
<h2 className="mb-6 text-lg font-semibold">
{t("createSubAgent")}
</h2>
<div className="flex max-w-lg flex-col gap-4">
<div className="flex flex-col gap-1.5">
<span className="text-sm font-medium">
{t("agentManagement")}
</span>
{agents.length === 0 ? (
<p className="text-sm text-muted">
No agents with sub-agent support found.
</p>
) : (
<select
value={agentId}
onChange={(e) => setAgentId(e.target.value)}
className="
rounded-md border border-border bg-background
px-3 py-2 text-sm outline-none
focus:outline-none
"
>
{agents.map((a) => (
<option key={a.id} value={a.id}>
{a.name}
</option>
))}
</select>
)}
</div>

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
className="min-h-48"
variant="secondary"
/>
</TextField>

<div className="flex gap-2 pt-2">
<Button
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
<Button variant="ghost" onPress={onCancel}>
{t("cancel")}
</Button>
</div>
</div>
</div>
);
}

function SubAgentEditForm({
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
<div className="flex flex-1 flex-col overflow-y-auto p-6">
<h2 className="mb-6 text-lg font-semibold">
{t("editSubAgent")}
</h2>
<div className="flex max-w-lg flex-col gap-4">
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
className="min-h-48"
variant="secondary"
/>
</TextField>

<div className="flex gap-2 pt-2">
<Button
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
<Button variant="ghost" onPress={onCancel}>
{t("cancel")}
</Button>
</div>
</div>
</div>
);
}

function SubAgentDetail({
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
const { t } = useTranslation();
return (
<div className="flex flex-1 flex-col overflow-y-auto p-6">
<div className="flex items-start justify-between gap-4">
<h2 className="text-lg font-semibold">{agent.name}</h2>
<div className="flex gap-2">
<Button
isIconOnly
variant="ghost"
size="sm"
onPress={onEdit}
aria-label={t("editSubAgent")}
>
<PencilIcon className="size-4" />
</Button>
<Button
isIconOnly
variant="ghost"
size="sm"
isDisabled={isDeleting}
onPress={onDelete}
aria-label={t("deleteSubAgent")}
>
<TrashIcon className="size-4 text-danger" />
</Button>
</div>
</div>

{agent.description && (
<p className="mt-2 text-sm text-muted">{agent.description}</p>
)}

<div className="mt-4 flex flex-wrap gap-3">
{agent.agent && (
<div className="flex items-center gap-1.5">
<span className="text-xs text-muted">Agent:</span>
<Surface
variant="secondary"
className="rounded-full px-2 py-0.5 text-xs"
>
{agent.agent}
</Surface>
</div>
)}
{agent.source && (
<div className="flex items-center gap-1.5">
<span className="text-xs text-muted">Source:</span>
<span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs">
{agent.source}
</span>
</div>
)}
</div>

{agent.instruction ? (
<div className="mt-6">
<h3 className="mb-2 text-sm font-medium">
{t("subAgentInstruction")}
</h3>
<Surface
variant="secondary"
className="rounded-lg p-4 font-mono text-sm whitespace-pre-wrap"
>
{agent.instruction}
</Surface>
</div>
) : (
<div className="mt-6 rounded-lg border border-dashed border-border p-6 text-center">
<p className="text-sm text-muted">
No instruction set. Click edit to add one.
</p>
</div>
)}
</div>
);
}
