import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Button, Label, Modal, TextField, Input, Select, ListBox, Checkbox } from "@heroui/react"
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query"
import { useServer } from "../providers/server"
import { createApi } from "../lib/api"
import type { TransportDto } from "../lib/api-types"

interface CreateMcpDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function CreateMcpDialog({ isOpen, onClose }: CreateMcpDialogProps) {
  const { t } = useTranslation()
  const { baseUrl } = useServer()
  const api = createApi(baseUrl)
  const queryClient = useQueryClient()

  // Fetch available agents
  const { data: agents = [] } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.agents.list(),
  })

  const [name, setName] = useState("")
  const [transportType, setTransportType] = useState<"stdio" | "sse" | "streamable_http">("stdio")
  const [timeout, setTimeoutValue] = useState("")
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set(["default"]))

  // stdio fields
  const [command, setCommand] = useState("")
  const [args, setArgs] = useState("")
  const [env, setEnv] = useState("")

  // http fields
  const [url, setUrl] = useState("")
  const [headers, setHeaders] = useState("")

  const [enabled, setEnabled] = useState(true)

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setName("")
      setTransportType("stdio")
      setTimeoutValue("")
      setEnabled(true)
      setCommand("")
      setArgs("")
      setEnv("")
      setUrl("")
      setHeaders("")
      setSelectedAgents(new Set(["default"]))
    }
  }, [isOpen])

  const createMutation = useMutation({
    mutationFn: ({ agent, body }: { agent: string; body: { name: string; transport: TransportDto; timeout?: number } }) => {
      return api.mcps.create(agent, "global", body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcps"] })
    },
  })

  const buildTransport = (): TransportDto | undefined => {
    const timeoutNum = timeout ? parseInt(timeout, 10) : undefined

    if (transportType === "stdio") {
      const argsArray = args.trim() ? args.trim().split(/\s+/) : []
      const envRecord: Record<string, string> | undefined = env.trim()
        ? Object.fromEntries(
            env
              .trim()
              .split("\n")
              .map((line) => {
                const eqIndex = line.indexOf("=")
                if (eqIndex === -1) return [line, ""]
                return [line.slice(0, eqIndex), line.slice(eqIndex + 1)]
              })
          )
        : undefined

      return {
        type: "stdio",
        command: command.trim(),
        args: argsArray,
        env: envRecord,
        timeout: timeoutNum,
      }
    }

    const headersRecord: Record<string, string> | undefined = headers.trim()
      ? Object.fromEntries(
          headers
            .trim()
            .split("\n")
            .map((line) => {
              const colonIndex = line.indexOf(":")
              if (colonIndex === -1) return [line.trim(), ""]
              return [line.slice(0, colonIndex).trim(), line.slice(colonIndex + 1).trim()]
            })
        )
      : undefined

    return {
      type: transportType,
      url: url.trim(),
      headers: headersRecord,
      timeout: timeoutNum,
    }
  }

  const handleCreate = async () => {
    if (!name.trim()) return

    const transport = buildTransport()
    if (!transport) return

    const body = {
      name: name.trim(),
      transport,
      timeout: timeout ? parseInt(timeout, 10) : undefined,
    }

    // Create MCP for each selected agent
    const agentsToCreate = [...selectedAgents]
    await Promise.all(
      agentsToCreate.map((agent) =>
        createMutation.mutateAsync({ agent, body })
      )
    )
    onClose()
  }

  const isValid = () => {
    if (!name.trim()) return false
    if (transportType === "stdio" && !command.trim()) return false
    if (transportType !== "stdio" && !url.trim()) return false
    if (selectedAgents.size === 0) return false
    return true
  }

  const toggleAgent = (agentId: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) {
        next.delete(agentId)
      } else {
        next.add(agentId)
      }
      return next
    })
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
      <Modal.Container>
        <Modal.Dialog className="max-w-lg">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t("createMcpServer")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="flex flex-col gap-4">
              {/* Name */}
              <TextField className="w-full">
                <Label>{t("name")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("serverName")}
                />
              </TextField>

              {/* Transport Type */}
              <div className="flex flex-col gap-1.5">
                <Label>{t("transportType")}</Label>
                <Select
                  selectedKey={transportType}
                  onSelectionChange={(key) => setTransportType(key as "stdio" | "sse" | "streamable_http")}
                  className="w-full"
                >
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      <ListBox.Item id="stdio" textValue="stdio">stdio</ListBox.Item>
                      <ListBox.Item id="sse" textValue="sse">sse</ListBox.Item>
                      <ListBox.Item id="streamable_http" textValue="streamable_http">streamable_http</ListBox.Item>
                    </ListBox>
                  </Select.Popover>
                </Select>
              </div>

              {/* Stdio fields */}
              {transportType === "stdio" && (
                <>
                  <TextField className="w-full">
                    <Label>{t("command")}</Label>
                    <Input
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder="npx"
                    />
                  </TextField>
                  <TextField className="w-full">
                    <Label>{t("args")}</Label>
                    <Input
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      placeholder="-y @modelcontextprotocol/server-filesystem"
                    />
                    <span className="text-xs text-muted">{t("argsHelp")}</span>
                  </TextField>
                  <div className="flex flex-col gap-1.5">
                    <Label>{t("env")}</Label>
                    <textarea
                      value={env}
                      onChange={(e) => setEnv(e.target.value)}
                      placeholder="KEY=value&#10;ANOTHER_KEY=value"
                      className="w-full min-h-[80px] px-3 py-2 text-sm border border-default-200 rounded-md bg-background text-foreground resize-y font-mono"
                    />
                    <span className="text-xs text-muted">{t("envHelp")}</span>
                  </div>
                </>
              )}

              {/* HTTP fields */}
              {(transportType === "sse" || transportType === "streamable_http") && (
                <>
                  <TextField className="w-full">
                    <Label>URL</Label>
                    <Input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="http://localhost:3000/sse"
                    />
                  </TextField>
                  <div className="flex flex-col gap-1.5">
                    <Label>{t("headers")}</Label>
                    <textarea
                      value={headers}
                      onChange={(e) => setHeaders(e.target.value)}
                      placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
                      className="w-full min-h-[80px] px-3 py-2 text-sm border border-default-200 rounded-md bg-background text-foreground resize-y font-mono"
                    />
                    <span className="text-xs text-muted">{t("headersHelp")}</span>
                  </div>
                </>
              )}

              {/* Timeout */}
              <TextField className="w-full">
                <Label>{t("timeout")}</Label>
                <Input
                  type="number"
                  value={timeout}
                  onChange={(e) => setTimeoutValue(e.target.value)}
                  placeholder="60"
                />
                <span className="text-xs text-muted">{t("timeoutHelp")}</span>
              </TextField>

              {/* Enabled */}
              <Checkbox
                isSelected={enabled}
                onChange={setEnabled}
              >
                {t("enabled")}
              </Checkbox>

              {/* Agent Selection */}
              <div className="flex flex-col gap-2">
                <Label>{t("agents")}</Label>
                <div className="flex flex-wrap gap-2">
                  {agents.map((agent) => {
                    const isSelected = selectedAgents.has(agent.id)
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => toggleAgent(agent.id)}
                        className={`px-2.5 py-1 text-sm rounded-full border transition-colors ${
                          isSelected
                            ? "bg-accent text-accent-foreground border-accent"
                            : "bg-transparent text-muted border-default-200 hover:border-default-300"
                        }`}
                      >
                        {agent.display_name}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="secondary" onPress={onClose}>
              {t("cancel")}
            </Button>
            <Button
              onPress={handleCreate}
              isDisabled={!isValid() || createMutation.isPending}
            >
              {createMutation.isPending ? t("creating") : t("create")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}