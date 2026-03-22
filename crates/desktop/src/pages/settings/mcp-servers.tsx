import { useMemo, useState } from "react"
import { PlusIcon, ArrowPathIcon, TrashIcon } from "@heroicons/react/24/solid"
import { Button, Chip, Header, Label, ListBox, SearchField, Table, type Selection } from "@heroui/react"
import { useMcps } from "../../hooks/use-mcps"
import type { McpResponse } from "../../lib/api-types"

export default function MCPServersPage() {
  const { data: mcps, refetch } = useMcps()
  const [searchQuery, setSearchQuery] = useState("")
  const [selected, setSelected] = useState<Selection>(
    new Set(mcps.length > 0 ? [`${mcps[0].name}-${mcps[0].agent ?? "default"}`] : [])
  )

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
      const category = (server.agent ?? "unknown").toUpperCase()
      if (!acc[category]) acc[category] = []
      acc[category].push(server)
      return acc
    }, {} as Record<string, McpResponse[]>),
    [filteredServers]
  )

  return (
    <div className="flex h-full">
      {/* Servers List Panel */}
      <div className="w-80 shrink-0 border-r border-border flex flex-col">
        {/* Search Header */}
        <div className="flex items-center gap-2 p-3 border-b border-border">
          <SearchField
            value={searchQuery}
            onChange={setSearchQuery}
            aria-label="Search MCP servers"
            variant="secondary"
            className="flex-1 min-w-0"
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search servers..." />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Button isIconOnly variant="ghost" size="sm" className="shrink-0" aria-label="Add MCP server">
            <PlusIcon className="size-4" />
          </Button>
          <Button isIconOnly variant="ghost" size="sm" className="shrink-0" aria-label="Refresh servers" onPress={() => refetch()}>
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
            No servers match "{searchQuery}"
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
                <Button isIconOnly variant="ghost" size="sm" className="text-muted hover:text-danger shrink-0" aria-label="Remove server">
                  <TrashIcon className="size-4" />
                </Button>
              </div>

              {/* Connection / Transport */}
              <div className="mb-6">
                <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Transport</h3>
                <Table>
                  <Table.ScrollContainer>
                    <Table.Content aria-label="Transport details">
                      <Table.Header>
                        <Table.Column isRowHeader className="w-24">Property</Table.Column>
                        <Table.Column>Value</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        <Table.Row>
                          <Table.Cell>Type</Table.Cell>
                          <Table.Cell>{selectedServer.transport.type}</Table.Cell>
                        </Table.Row>
                        {selectedServer.transport.type === "stdio" && (
                          <>
                            <Table.Row>
                              <Table.Cell>Command</Table.Cell>
                              <Table.Cell>{selectedServer.transport.command}</Table.Cell>
                            </Table.Row>
                            {selectedServer.transport.args && selectedServer.transport.args.length > 0 && (
                              <Table.Row>
                                <Table.Cell>Args</Table.Cell>
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
                            <Table.Cell>URL</Table.Cell>
                            <Table.Cell>
                              <code className="font-mono text-xs break-all">{selectedServer.transport.url}</code>
                            </Table.Cell>
                          </Table.Row>
                        )}
                        {selectedServer.timeout && (
                          <Table.Row>
                            <Table.Cell>Timeout</Table.Cell>
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
            <p className="text-sm text-muted">Select a server to view details</p>
          </div>
        )}
      </div>
    </div>
  )
}
