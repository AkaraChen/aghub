# MCP marketplace scope and compatibility

Checked against official documentation and the current adapters on 2026-08-31.
Client documentation describes native capabilities, not a claim that aghub can
edit every native option or that a server has been tested in each client.

## Purpose

The marketplace is an optional discovery and configuration-import entry point.
The user's agent configuration files remain the source of truth. Existing MCP
management owns editing and removal after installation; the marketplace does not
maintain a second installation database.

The [official Registry](https://modelcontextprotocol.io/registry/about) stores
metadata pointing to packages or remote endpoints. It does not host the server
binaries. Namespace verification identifies the publisher; it is not a review of
the server's code. The Registry is still in preview.

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

### TOML configuration preservation

The current TOML adapter parses stdio entries with a string `command`. When it
saves the parsed set, it removes deleted stdio entries but retains entries it
cannot parse, including Codex remote servers and their native authentication
fields. Preservation here is of TOML values, not comments or original formatting.
This does not add remote-server editing to the adapter.

## Client documentation and adapter boundaries

| Client                                                                                     | Native documentation                                                                                                                                                              | Boundary for this marketplace                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Claude Code](https://code.claude.com/docs/en/mcp)                                         | stdio, recommended HTTP, deprecated but supported SSE; `streamable-http` aliases `http`. WebSocket is configured separately and has header-only authentication.                   | Basic stdio/SSE/HTTP methods use the existing adapter. WebSocket is outside the current shared transport model. OAuth and plugin-provided MCP lifecycle remain with Claude Code.                                  |
| [Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)                             | stdio and Streamable HTTP, bearer-token environment references, HTTP headers, OAuth; global and project `.codex/config.toml`.                                                     | The current descriptor still has `remote: false` and its parser reads stdio only. Remote entries are retained during unrelated saves, but are not available as marketplace install targets or editable inventory. |
| [Cursor](https://cursor.com/docs/mcp)                                                      | stdio, SSE, Streamable HTTP, and remote OAuth.                                                                                                                                    | Basic transports use the existing adapter. Desktop/IDE documentation must not be treated as proof of identical cloud-agent behavior.                                                                              |
| [Gemini CLI](https://geminicli.com/docs/tools/mcp-server/)                                 | `command` selects stdio, `url` selects SSE, `httpUrl` selects Streamable HTTP; native OAuth and environment expansion.                                                            | The existing format strategy handles the transport-specific fields. Native authentication and tool policies are not portable marketplace fields.                                                                  |
| [VS Code / Copilot](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) | Editor `.vscode/mcp.json` differs from agent-host `.mcp.json` / Copilot configuration. Supports native input variables, OAuth, and HTTP over Unix sockets or Windows named pipes. | Select an actual descriptor and scope, not a generic Copilot-branded destination. Native input prompts, socket transports, and enterprise authentication are not represented by the current install model.        |
| [OpenCode](https://opencode.ai/docs/mcp-servers/)                                          | `mcp` entries use `local` or `remote`; the client owns OAuth discovery, authentication, and stored credentials.                                                                   | Keep the existing native format mapping. Installing configuration does not establish an authenticated connection.                                                                                                 |

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

1. Extend the Codex adapter with loss-aware Streamable HTTP read/write support,
   then advertise that transport. Preserve native auth references and fields;
   leave login and token storage to Codex.
2. Replace the coarse remote capability flag with explicit transport support
   when extending adapters. Do not infer SSE, HTTP, WebSocket, or socket support
   from one another. Keep unknown transports visible as unsupported rather than
   inventing a fallback configuration.
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
