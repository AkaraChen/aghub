# MCP marketplace scope and compatibility

Checked against official documentation and the current adapters on 2026-08-31.
Client documentation describes native capabilities, not a claim that aghub can
edit every native option or that a server has been tested in each client.

## Purpose

The marketplace is an optional discovery and configuration-import entry point.
The user's agent configuration files remain the source of truth. Existing MCP
management owns editing and removal after installation; the marketplace does not
maintain a second installation database.

The [MCP Registry](https://modelcontextprotocol.io/registry/about) stores
metadata pointing to packages or remote endpoints. It does not host the server
binaries. Namespace verification identifies the publisher; it is not a review of
the server's code. The Registry is still in preview.

The built-in source is named **MCP Registry** in every locale, like **skills.sh**
in the Skill marketplace. Neither “official” nor “most authoritative” is a
quality label for the listed servers. Custom sources retain their chosen names.

## Implementation plan and acceptance

This PR covers MCP configuration and catalog import. Platform Apps and
account-managed connections are separate products and are out of scope. aghub
does not read another client's credential store, migrate account grants, or
create its own OAuth token store.

Implementation order:

1. **Source identity and safe editing.** Use the source's name in the selector;
   preserve native fields, comments, and unrecognized entries when editing a
   supported local entry. Malformed known fields must fail before writing.
2. **Native transports.** Add Codex Streamable HTTP read/write and its native
   enabled flag; split legacy SSE from HTTP capabilities. Correct Gemini's
   `httpUrl` mapping and Amp's literal `amp.mcpServers` key and project path.
3. **Connection options and authentication.** Common fields belong in the MCP
   editor; target-specific fields remain native. Preserve bearer environment
   references, header references, OAuth metadata, working directories, timeouts,
   and tool policies. Add explicit controls and validation per supported target,
   without pretending all native options are interchangeable. Native login
   handoff and authentication observations are separate from config writes.
4. **Remaining client adapters.** Verify paths, format, scope, timeout units,
   native version and product variant against the matrix below. Do not migrate
   a user's existing files just because newer documentation names another path.
5. **Catalog usability.** Pagination, unsupported-method explanations, target
   paths, write previews, and source ownership. Reuse the MCP management flow;
   do not add another configuration store or runtime.

Acceptance is per adapter, not per brand: parse → edit → save → read tests with
native examples; unknown fields retained; disabled entries remain disabled;
unsupported transport rejected before writing. Renames must retain native
options and reject existing destination names. Unit/integration tests use
temporary files; browser tests use isolated fixtures and ports. A passing
configuration test is not an authenticated live-server test.

### State and credential boundaries

| Observation                         | What aghub may claim                                   |
| ----------------------------------- | ------------------------------------------------------ |
| Matching local configuration        | Configured at that location                            |
| Native enabled flag                 | Enabled/disabled in that configuration                 |
| Native client reports authorization | Authorized in that client, at the observed time        |
| Native client reports a connection  | Connected in that client, at the observed time         |
| Registry listing                    | Metadata from the named source, not a verified runtime |

Bearer/PAT values can be configured for multiple clients with explicit user
selection. Environment references remain references; aghub does not resolve
them into secrets. An OAuth grant belongs to the client that created it. A
login action must name that client and must not imply authorization for other
agents. Plugin-owned MCP entries remain plugin-owned, not automatically copied
into standalone configuration. None of these operations manages platform Apps.

### Client follow-up matrix

This retains the full adapter scope. Entries marked “verify” are not advertised
as working support merely because a generic JSON writer accepts the file.

| Agent             | Native contract to verify / complete                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Claude Code       | `.mcp.json`, user/local scopes in `.claude.json`; HTTP/SSE, native OAuth and tool policy; plugin ownership      |
| Codex             | `.codex/config.toml`; stdio/Streamable HTTP; native headers, environment references, OAuth and tool policy      |
| Cursor            | `.cursor/mcp.json`; environment interpolation, `envFile`, OAuth; distinguish file and dynamic sources           |
| Gemini CLI        | `.gemini/settings.json`; `url` is SSE, `httpUrl` is HTTP; millisecond timeout, OAuth and tool filters           |
| Amp               | `.amp/settings.json`; literal `amp.mcpServers`; JSONC, references and native authorization                      |
| OpenCode          | root `opencode.json` / JSONC and user config; local command array, remote OAuth, `environment`                  |
| OpenClaw          | native `mcp.servers` in `openclaw.json` versus separate mcporter configuration; verify installed variant        |
| Cline             | verify CLI versus extension paths and conflicting documentation; `streamableHttp`, disabled and approval fields |
| Copilot / VS Code | distinguish CLI, editor profile and Agent Host; `servers`, native inputs and authorization                      |
| Antigravity       | verify new versus existing config paths, `serverUrl`, native OAuth and disabled state                           |
| Kiro              | file-based configuration versus agent JSON; scope precedence, disabled/tool approval fields                     |
| Windsurf          | distinguish legacy Cascade from Devin Local; `serverUrl`, configuration ownership                               |
| TRAE              | obtain and validate current native file/transport contract before adding claims                                 |
| Zed               | `context_servers`; native remote OAuth, permissions and extension sources; verify project scope                 |
| JetBrains AI      | native UI/import support versus lack of aghub file adapter; distinguish AI Assistant and Junie                  |
| Roo Code          | extension-owned global file versus `.roo/mcp.json`; `streamable-http`, cwd and timeout units                    |
| Kimi Code         | verify `.kimi-code` versus `.kimi` and home override; `transport`, native auth and tool policy                  |
| Mistral Vibe      | `.vibe/config.toml`, `[[mcp_servers]]` array, native HTTP; do not claim OAuth where unsupported                 |
| Pi                | no built-in MCP contract; extensions have their own ownership and configuration                                 |
| Augment / Auggie  | project/local/managed settings and priority; stdio/HTTP/SSE and native auth                                     |
| Kilo Code         | verify new `kilo.json` / JSONC `mcp` versus legacy extension configuration                                      |
| Factory Droid     | ancestor/project/user files and personal overrides; native auth and timeout units                               |
| Warp              | `.warp/.mcp.json`, `working_directory`; conditional discovery from other clients' configurations                |

These follow-ups do not widen this PR into account/Apps management. Detailed
client changes require their own verified examples before the capability is
enabled in the descriptor.

Three separate compatibility layers must not be conflated:

| Layer                | Examples                             | aghub responsibility                                              |
| -------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| Distribution         | npm, PyPI, NuGet, OCI images         | Normalize package metadata into a launch plan                     |
| MCP transport        | stdio, SSE, Streamable HTTP          | Match the method to supported target adapters                     |
| Client configuration | TOML, `mcpServers`, OpenCode's `mcp` | Use the existing descriptor and serializer for the selected scope |

OCI is a package distribution option, not another MCP protocol. An OCI stdio
method generates a container-launch command. aghub does not install Docker,
download the image, start the container, or call its tools during installation.

## Current implementation

- `crates/mcp-catalog` owns Registry wire types, network policy, and normalization.
  The renderer receives source-neutral catalog entries through API DTOs.
- Each method contains its transport and declared inputs. The renderer resolves
  those inputs into the existing `CreateMcpRequest`, without package-specific
  command construction in components.
- Search, source selection, transport filters, global/project targets, secret
  fields, redacted preview, and explicit confirmation belong in this flow.
- Installed locations are derived from live local configuration. **Installed**
  means a matching configuration exists, not that authentication, connection, or
  tool execution has succeeded.
- An unavailable local inventory is an error with retry, not an empty inventory.
- Custom sources currently mean public endpoints implementing the Registry API.
  Authenticated and private-network registries are not supported. URL, DNS,
  redirect, response-size, and timeout restrictions still apply.

### OCI environment forwarding

The normalized OCI plan places `--env=NAME` before the image reference and marks
it conditional on that name existing in the resolved MCP environment. Blank
optional fields produce neither an environment entry nor a forwarding argument.
Only the name enters the generated argument; the value stays in the MCP process
environment. This follows [Docker's environment options](https://docs.docker.com/reference/cli/docker/container/run/#env).

Preview redaction uses the same blank-value rule as installation. Unit and
browser tests cover required values, defaults, whitespace-only optional values,
argument placement, redaction, and installed-state matching. These tests validate
configuration generation; they do not execute a Docker container.

### Native configuration editing delivered in this batch

- JSON/JSONC map and OpenCode adapters patch the existing document. Native
  fields outside the shared editor, unrelated settings, comments, and unknown
  transport entries are retained. Unknown transports are not editable inventory
  yet; preservation does not mean aghub can launch or validate them.
- The Codex TOML adapter reads and writes stdio and Streamable HTTP entries,
  including `http_headers` and native `enabled`. It preserves untouched TOML
  comments and native authentication references, startup/tool timeouts and tool
  policies. Legacy SSE is rejected before writing.
- Gemini reads and writes `httpUrl` for Streamable HTTP and `url` for SSE.
  Amp uses the literal `amp.mcpServers` key and `.amp/settings.json` project path.
- Editing or renaming an existing entry keeps its native options. Destination
  name collisions and malformed known fields return errors before writing.
- Descriptors, API responses, and target selection distinguish SSE from
  Streamable HTTP. The API retains `remote` as a compatibility summary, but new
  target selection uses the exact transport flags.

These guarantees apply to editing an existing entry in its own configuration.
They do not make unmodeled native options portable across agents. New controls
for bearer references, OAuth options, timeout units and tool policy, native
login handoff, and authentication observations remain follow-up work. No client
credential store or platform Apps connection is read or changed.

## Client documentation and adapter boundaries

| Client                                                                                     | Native documentation                                                                                                                                                              | Boundary for this marketplace                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Claude Code](https://code.claude.com/docs/en/mcp)                                         | stdio, recommended HTTP, deprecated but supported SSE; `streamable-http` aliases `http`. WebSocket is configured separately and has header-only authentication.                   | Basic stdio/SSE/HTTP methods use the existing adapter. WebSocket is outside the current shared transport model. OAuth and plugin-provided MCP lifecycle remain with Claude Code.                               |
| [Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)                             | stdio and Streamable HTTP, bearer-token environment references, HTTP headers, OAuth; global and project `.codex/config.toml`.                                                     | stdio/HTTP entries can be listed, edited and installed. Native auth references and tool policy survive edits; native login and advanced-field controls are not implemented here. SSE is not an install target. |
| [Cursor](https://cursor.com/docs/mcp)                                                      | stdio, SSE, Streamable HTTP, and remote OAuth.                                                                                                                                    | Basic transports use the existing adapter. Desktop/IDE documentation must not be treated as proof of identical cloud-agent behavior.                                                                           |
| [Gemini CLI](https://geminicli.com/docs/tools/mcp-server/)                                 | `command` selects stdio, `url` selects SSE, `httpUrl` selects Streamable HTTP; native OAuth and environment expansion.                                                            | Native transport keys are mapped separately. Authentication and tool policy survive local edits but are not portable marketplace fields.                                                                       |
| [VS Code / Copilot](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) | Editor `.vscode/mcp.json` differs from agent-host `.mcp.json` / Copilot configuration. Supports native input variables, OAuth, and HTTP over Unix sockets or Windows named pipes. | Select an actual descriptor and scope, not a generic Copilot-branded destination. Native input prompts, socket transports, and enterprise authentication are not represented by the current install model.     |
| [OpenCode](https://opencode.ai/docs/mcp-servers/)                                          | `mcp` entries use `local` or `remote`; the client owns OAuth discovery, authentication, and stored credentials.                                                                   | Keep the existing native format mapping. Installing configuration does not establish an authenticated connection.                                                                                              |

## Protocol updates are not marketplace settings

The [2026-07-28 MCP specification](https://modelcontextprotocol.io/specification/2026-07-28)
describes stateless requests and per-request capability negotiation, with optional
extensions such as Tasks, Skills over MCP, and MCP Apps. Individual client and
server support still has to be established; a registry listing does not prove
support for a particular revision or extension.

The [Registry REST API](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/generic-registry-api.md)
is a separate versioned interface. Its current `v0.1` endpoint is not an outdated
MCP transport revision. Changing a protocol date must not change the catalog API
path or introduce a protocol-version selector into the install dialog.

## Follow-up priorities

These are identified gaps, not completed support:

1. Add native connection-option controls and login handoff per verified client.
   Explain which options can be copied and which stay client-specific before a
   cross-agent transfer; never report a configuration write as authorization.
2. Audit the remaining client contracts above and expose unknown transports as
   unsupported inventory rather than inventing a fallback configuration. Do not
   infer WebSocket or socket support from SSE or Streamable HTTP.
3. Expose Registry pagination. The current search requests the first 60 latest
   matches and does not consume `metadata.nextCursor`; it is not an exhaustive
   catalog view. Methods without supported metadata are omitted, and a malformed
   response fails the request rather than being reported as a partial success.
4. Distinguish native/plugin ownership and runtime/authentication observations
   from writable local installations before adding those sources to inventory.
5. Add another catalog adapter only when a concrete second source is supported.
   Public Registry-compatible sources can reuse today's client. Private sources
   need an explicit authentication and network-trust design, not relaxed default
   URL checks.

No ratings system, user accounts, package mirroring, server runtime, tool
playground, automatic runtime installer, or separate OAuth credential store is
needed for this PR. Advanced native settings belong with agent configuration;
the marketplace should ask only for the values needed by the selected method.
