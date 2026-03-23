import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { PlusIcon, ArrowPathIcon, TrashIcon, ExclamationTriangleIcon } from "@heroicons/react/24/solid"
import { Button, Header, Label, ListBox, Modal, SearchField, Table, type Selection } from "@heroui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMcps } from "../../hooks/use-mcps"
import { useServer } from "../../providers/server"
import { createApi } from "../../lib/api"
import type { McpResponse } from "../../lib/api-types"

export default function MCPServersPage() {
  const { t } = useTranslation()
  const { baseUrl } = useServer()
  const api = createApi(baseUrl)
  const queryClient = useQueryClient()
  const { data: mcps, refetch } = useMcps()
  const [searchQuery, setSearchQuery] = useState("")
  const [selected, setSelected] = useState<Selection>(
    new Set(mcps.length > 0 ? [`${mcps[0].name}-${mcps[0].agent ?? "default"}`] : [])
  )
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [serverToDelete, setServerToDelete] = useState<McpResponse | null>(null)

  const selectedKey = [...(selected as Set<string>)][0]
  const selectedServer = mcps.find(
    (s) => `${s.name}-${s.agent ?? "default"}` === selectedKey
  ) ?? null

  const filteredServers = useMemo(
    () => mcps.filter(
      (server) =>
        server.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (server.source ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (server.agent ?? "").toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [mcps, searchQuery]
  )

  const groupedServers = useMemo(
    () => filteredServers.reduce((acc, server) => {
      const category = (server.agent ?? t("unknown")).toUpperCase()
      if (!acc[category]) acc[category] = []
      acc[category].push(server)
      return acc
    }, {} as Record<string, McpResponse[]>),
    [filteredServers]
  )

  const deleteMutation = useMutation({
    mutationFn: (server: McpResponse) => {
      const scope = server.source === "Project" ? "project" : "global"
      return api.mcps.delete(server.name, server.agent ?? "default", scope)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcps"] })
      setDeleteDialogOpen(false)
      setServerToDelete(null)
      // Clear selection if deleted server was selected
      if (selectedServer && serverToDelete &&
          `${selectedServer.name}-${selectedServer.agent ?? "default"}` ===
          `${serverToDelete.name}-${serverToDelete.agent ?? "default"}`) {
        setSelected(new Set())
      }
    },
    onError: (error) => {
      console.error("Failed to delete MCP server:", error)
    }
  })

  const handleDeleteClick = (server: McpResponse) => {
    setServerToDelete(server)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = () => {
    if (serverToDelete) {
      deleteMutation.mutate(serverToDelete)
    }
  }

  return (
    <div className="flex h-full">
      {/* Servers List Panel */}
      <div className="w-80 shrink-0 border-r border-border flex flex-col">
        {/* Search Header */}
        <div className="flex items-center gap-2 p-3 border-b border-border">
          <SearchField
            value={searchQuery}
            onChange={setSearchQuery}
            aria-label={t("searchServers")}
            variant="secondary"
            className="flex-1 min-w-0"
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={t("searchServers")} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Button isIconOnly variant="ghost" size="sm" className="shrink-0" aria-label={t("addMcpServer")}>
            <PlusIcon className="size-4" />
          </Button>
          <Button isIconOnly variant="ghost" size="sm" className="shrink-0" aria-label={t("refreshServers")} onPress={() => refetch()}>
            <ArrowPathIcon className="size-4" />
          </Button>
        </div>

        {/* Servers List */}
        <ListBox
          aria-label="MCP Servers"
          selectionMode="single"
          selectedKeys={selected}
          onSelectionChange={setSelected}
          className="flex-1 overflow-y-auto p-2"
        >
          {Object.entries(groupedServers).map(([category, servers]) => (
            <ListBox.Section key={category} aria-label={category}>
              <Header className="px-2 py-1.5 text-xs font-medium text-muted uppercase tracking-wide">
                {category}
              </Header>
              {servers.map((server) => {
                const id = `${server.name}-${server.agent ?? "default"}`
                return (
                  <ListBox.Item key={id} id={id} textValue={server.name} className="data-[selected]:bg-accent/10">
                    <Label className="truncate">{server.name}</Label>
                  </ListBox.Item>
                )
              })}
            </ListBox.Section>
          ))}
        </ListBox>
        {filteredServers.length === 0 && (
          <p className="px-3 py-6 text-sm text-muted text-center">
            {t("noServersMatch")} &ldquo;{searchQuery}&rdquo;
          </p>
        )}
      </div>

      {/* Server Detail Panel */}
      <div className="flex-1 overflow-hidden">
        {selectedServer ? (
          <div className="h-full overflow-y-auto">
            <div className="p-6 max-w-3xl">
              {/* Header */}
              <div className="flex items-center justify-between gap-3 mb-2">
                <h2 className="text-xl font-semibold text-foreground truncate">{selectedServer.name}</h2>
                <Button
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  className="text-muted hover:text-danger shrink-0"
                  aria-label={t("remove")}
                  onPress={() => handleDeleteClick(selectedServer)}
                >
                  <TrashIcon className="size-4" />
                </Button>
              </div>

              {/* Connection / Transport */}
              <div className="mb-6">
                <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-3">{t("transport")}</h3>
                <Table>
                  <Table.ScrollContainer>
                    <Table.Content aria-label="Transport details">
                      <Table.Header>
                        <Table.Column isRowHeader className="w-24">{t("type")}</Table.Column>
                        <Table.Column>Value</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        <Table.Row>
                          <Table.Cell>{t("type")}</Table.Cell>
                          <Table.Cell>{selectedServer.transport.type}</Table.Cell>
                        </Table.Row>
                        {selectedServer.transport.type === "stdio" && (
                          <>
                            <Table.Row>
                              <Table.Cell>{t("command")}</Table.Cell>
                              <Table.Cell>{selectedServer.transport.command}</Table.Cell>
                            </Table.Row>
                            {selectedServer.transport.args && selectedServer.transport.args.length > 0 && (
                              <Table.Row>
                                <Table.Cell>{t("args")}</Table.Cell>
                                <Table.Cell>
                                  <code className="font-mono text-xs break-all">
                                    {selectedServer.transport.args.join(" ")}
                                  </code>
                                </Table.Cell>
                              </Table.Row>
                            )}
                          </>
                        )}
                        {(selectedServer.transport.type === "sse" || selectedServer.transport.type === "streamable_http") && (
                          <Table.Row>
                            <Table.Cell>{t("url")}</Table.Cell>
                            <Table.Cell>
                              <code className="font-mono text-xs break-all">{selectedServer.transport.url}</code>
                            </Table.Cell>
                          </Table.Row>
                        )}
                        {selectedServer.timeout && (
                          <Table.Row>
                            <Table.Cell>{t("timeout")}</Table.Cell>
                            <Table.Cell>{selectedServer.timeout}s</Table.Cell>
                          </Table.Row>
                        )}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted">{t("selectServer")}</p>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Modal.Backdrop isOpen={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <div className="flex items-center gap-2">
                <ExclamationTriangleIcon className="size-5 text-warning" />
                <Modal.Heading>{t("deleteMcpServer")}</Modal.Heading>
              </div>
            </Modal.Header>
            <Modal.Body>
              <p className="text-sm text-muted">
                {t("deleteMcpServerConfirm", { name: serverToDelete?.name })}
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button
                slot="close"
                variant="secondary"
                onPress={() => setDeleteDialogOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                variant="danger"
                onPress={handleConfirmDelete}
                isDisabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? t("deleting") : t("remove")}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  )
}
