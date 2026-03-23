import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Button, Description, Fieldset, Label, Modal, TextField, Input, Select, ListBox, Checkbox } from "@heroui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useServer } from "../providers/server"
import { createApi, type UpdateMcpRequest } from "../lib/api"
import type { McpResponse, TransportDto } from "../lib/api-types"

interface EditMcpDialogProps {
  server: McpResponse
  isOpen: boolean
  onClose: () => void
}

export function EditMcpDialog({ server, isOpen, onClose }: EditMcpDialogProps) {
  const { t } = useTranslation()
  const { baseUrl } = useServer()
  const api = createApi(baseUrl)
  const queryClient = useQueryClient()

  const [name, setName] = useState(server.name)
  const [transportType, setTransportType] = useState<"stdio" | "sse" | "streamable_http">(server.transport.type)
  const [timeout, setTimeoutValue] = useState(server.timeout?.toString() ?? "")

  // stdio fields
  const [command, setCommand] = useState(
    server.transport.type === "stdio" ? server.transport.command : ""
  )
  const [args, setArgs] = useState(
    server.transport.type === "stdio" && server.transport.args ? server.transport.args.join(" ") : ""
  )
  const [env, setEnv] = useState(() => {
    if (server.transport.type === "stdio" && server.transport.env) {
      return Object.entries(server.transport.env)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n")
    }
    return ""
  })

  // http fields
  const [url, setUrl] = useState(
    server.transport.type !== "stdio" ? server.transport.url : ""
  )
  const [headers, setHeaders] = useState(() => {
    if (server.transport.type !== "stdio" && server.transport.headers) {
      return Object.entries(server.transport.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    }
    return ""
  })

  const [enabled, setEnabled] = useState(server.enabled)

  // Reset form when server changes
  useEffect(() => {
    setName(server.name)
    setTransportType(server.transport.type)
    setTimeoutValue(server.timeout?.toString() ?? "")
    setEnabled(server.enabled)

    if (server.transport.type === "stdio") {
      setCommand(server.transport.command)
      setArgs(server.transport.args?.join(" ") ?? "")
      setEnv(
        server.transport.env
          ? Object.entries(server.transport.env)
              .map(([k, v]) => `${k}=${v}`)
              .join("\n")
          : ""
      )
      setUrl("")
      setHeaders("")
    } else {
      setUrl(server.transport.url)
      setHeaders(
        server.transport.headers
          ? Object.entries(server.transport.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join("\n")
          : ""
      )
      setCommand("")
      setArgs("")
      setEnv("")
    }
  }, [server])

  const updateMutation = useMutation({
    mutationFn: (body: UpdateMcpRequest) => {
      const scope = server.source === "Project" ? "project" : "global"
      return api.mcps.update(server.name, server.agent ?? "default", scope, body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcps"] })
      onClose()
    },
    onError: (error) => {
      console.error("Failed to update MCP server:", error)
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

  const handleSave = () => {
    if (!name.trim()) return

    const body: UpdateMcpRequest = {
      name: name.trim() !== server.name ? name.trim() : undefined,
      enabled: enabled !== server.enabled ? enabled : undefined,
      timeout: timeout ? parseInt(timeout, 10) : undefined,
    }

    const transport = buildTransport()
    if (transport) {
      body.transport = transport
    }

    updateMutation.mutate(body)
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onClose}>
      <Modal.Container>
        <Modal.Dialog className="max-w-lg">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t("editMcpServer")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <Fieldset>
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
              <TextField className="w-full">
                <Label>{t("transportType")}</Label>
                <Select
                  selectedKey={transportType}
                  onSelectionChange={(key) => setTransportType(key as "stdio" | "sse" | "streamable_http")}
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
              </TextField>

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
                    <Description>{t("argsHelp")}</Description>
                  </TextField>
                  <TextField className="w-full">
                    <Label>{t("env")}</Label>
                    <textarea
                      value={env}
                      onChange={(e) => setEnv(e.target.value)}
                      placeholder="KEY=value&#10;ANOTHER_KEY=value"
                      className="w-full min-h-[80px] px-3 py-2 text-sm border border-default-200 rounded-md bg-background text-foreground resize-y font-mono"
                    />
                    <Description>{t("envHelp")}</Description>
                  </TextField>
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
                  <TextField className="w-full">
                    <Label>{t("headers")}</Label>
                    <textarea
                      value={headers}
                      onChange={(e) => setHeaders(e.target.value)}
                      placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
                      className="w-full min-h-[80px] px-3 py-2 text-sm border border-default-200 rounded-md bg-background text-foreground resize-y font-mono"
                    />
                    <Description>{t("headersHelp")}</Description>
                  </TextField>
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
                <Description>{t("timeoutHelp")}</Description>
              </TextField>

              {/* Enabled */}
              <Checkbox isSelected={enabled} onChange={setEnabled}>
                {t("enabled")}
              </Checkbox>
            </Fieldset>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="secondary" onPress={onClose}>
              {t("cancel")}
            </Button>
            <Button
              onPress={handleSave}
              isDisabled={!name.trim() || updateMutation.isPending}
            >
              {updateMutation.isPending ? t("saving") : t("save")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}