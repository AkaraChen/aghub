import { useMemo, useState } from "react"
import { PlusIcon, ArrowPathIcon, TrashIcon } from "@heroicons/react/24/solid"
import { Button, Card, Chip, Description, Header, Label, ListBox, SearchField, Table, type Selection } from "@heroui/react"
import { cn } from "../../lib/utils"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "../../components/ui/empty"

interface MCPServer {
  id: string
  name: string
  source: string
  tools: number
  status: "online" | "offline"
  category: string
  connection?: { type: string; command: string; args: string }
  toolsList?: { name: string; description: string }[]
}

const mcpServers: MCPServer[] = [
  {
    id: "context7-claude",
    name: "context7",
    source: "Global",
    tools: 2,
    status: "online",
    category: "CLAUDE CODE",
    connection: { type: "stdio", command: "npx", args: "-y @upstash/context7-mcp" },
    toolsList: [
      { name: "resolve-library-id", description: "Resolves a package/product name to a Context7-compatible library ID and returns matching libraries." },
      { name: "query-docs", description: "Retrieves and queries up-to-date documentation and code examples from Context7 for any programming library or framework." },
    ],
  },
  { id: "context7-poly", name: "context7", source: "poly-market", tools: 2, status: "online", category: "CLAUDE CODE" },
  { id: "shadcn", name: "shadcn", source: "poly-market", tools: 7, status: "online", category: "CLAUDE CODE" },
  { id: "better-auth", name: "better-auth", source: "poly-market", tools: 4, status: "online", category: "CLAUDE CODE" },
  { id: "context7-codex", name: "context7", source: "Global", tools: 2, status: "online", category: "CODEX" },
  { id: "pencil", name: "pencil", source: "Global", tools: 14, status: "online", category: "CODEX" },
]

export default function MCPServersPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selected, setSelected] = useState<Selection>(new Set([mcpServers[0].id]))

  const selectedServer = mcpServers.find(s => [...(selected as Set<string>)][0] === s.id) ?? null

  const filteredServers = useMemo(
    () => mcpServers.filter(
      (server) =>
        server.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        server.source.toLowerCase().includes(searchQuery.toLowerCase())
    ),
    [searchQuery]
  )

  const groupedServers = useMemo(
    () => filteredServers.reduce((acc, server) => {
      if (!acc[server.category]) acc[server.category] = []
      acc[server.category].push(server)
      return acc
    }, {} as Record<string, MCPServer[]>),
    [filteredServers]
  )

  const hasDetails = selectedServer && (
    selectedServer.connection ||
    (selectedServer.toolsList && selectedServer.toolsList.length > 0)
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
            className="flex-1"
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search servers..." />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Button isIconOnly variant="ghost" size="sm" aria-label="Add MCP server">
            <PlusIcon className="size-4" />
          </Button>
          <Button isIconOnly variant="ghost" size="sm" aria-label="Refresh servers">
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
              {servers.map((server) => (
                <ListBox.Item key={server.id} id={server.id} textValue={server.name}>
                  <div className="flex-1 min-w-0">
                    <Label>{server.name}</Label>
                    <Description>
                      <Chip
                        size="sm"
                        variant="flat"
                        color={server.source === "Global" ? "primary" : "default"}
                      >
                        {server.source}
                      </Chip>
                    </Description>
                  </div>
                  <span
                    title={server.status === "online" ? "Online" : "Offline"}
                    className={cn(
                      "size-2 rounded-full shrink-0",
                      server.status === "online" ? "bg-success" : "bg-muted"
                    )}
                  />
                  <span className="text-xs text-muted">{server.tools} tools</span>
                </ListBox.Item>
              ))}
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
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-xl font-semibold text-foreground">{selectedServer.name}</h2>
                <Button isIconOnly variant="ghost" size="sm" className="text-muted hover:text-danger" aria-label="Remove server">
                  <TrashIcon className="size-4" />
                </Button>
              </div>
              <p className="text-sm text-muted mb-6">{selectedServer.tools} tools</p>

              {/* Connection */}
              {selectedServer.connection && (
                <div className="mb-6">
                  <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Connection</h2>
                  <Table variant="secondary">
                    <Table.ScrollContainer>
                      <Table.Content aria-label="Connection details">
                        <Table.Header>
                          <Table.Column isRowHeader className="w-24">Property</Table.Column>
                          <Table.Column>Value</Table.Column>
                        </Table.Header>
                        <Table.Body>
                          <Table.Row>
                            <Table.Cell>Type</Table.Cell>
                            <Table.Cell>{selectedServer.connection.type}</Table.Cell>
                          </Table.Row>
                          <Table.Row>
                            <Table.Cell>Command</Table.Cell>
                            <Table.Cell>{selectedServer.connection.command}</Table.Cell>
                          </Table.Row>
                          <Table.Row>
                            <Table.Cell>Args</Table.Cell>
                            <Table.Cell>
                              <code className="font-mono text-xs break-all">{selectedServer.connection.args}</code>
                            </Table.Cell>
                          </Table.Row>
                        </Table.Body>
                      </Table.Content>
                    </Table.ScrollContainer>
                  </Table>
                </div>
              )}

              {/* Tools */}
              {selectedServer.toolsList && selectedServer.toolsList.length > 0 && (
                <div>
                  <h2 className="text-xs font-medium text-muted uppercase tracking-wide mb-3">
                    Tools ({selectedServer.toolsList.length})
                  </h2>
                  <div className="space-y-3">
                    {selectedServer.toolsList.map((tool) => (
                      <Card key={tool.name} variant="secondary">
                        <Card.Content>
                          <h3 className="font-mono text-xs font-semibold mb-2">{tool.name}</h3>
                          <p className="text-sm text-muted leading-relaxed">{tool.description}</p>
                        </Card.Content>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state for servers without detail data */}
              {!hasDetails && (
                <Empty className="mt-4">
                  <EmptyHeader>
                    <EmptyTitle>No details available</EmptyTitle>
                    <EmptyDescription>
                      Connection and tool information will appear here when the server is inspected.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted">
            Select a server to view details
          </div>
        )}
      </div>
    </div>
  )
}
