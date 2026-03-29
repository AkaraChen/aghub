# Deep Link Manual Testing

This document provides copy-pasteable `aghub://` examples for manual QA of
the desktop deep-link import flow.

Supported routes:

- Skill import:
  - `aghub://import?type=skill&source=skills-sh&name=<skill-name>`
- MCP import:
  - `aghub://import?type=mcp&payload=<base64url-json>`

## How to open a deep link

macOS:

```bash
open 'aghub://import?type=skill&source=skills-sh&name=serena'
```

Linux:

```bash
xdg-open 'aghub://import?type=skill&source=skills-sh&name=serena'
```

Windows:

```powershell
Start-Process 'aghub://import?type=skill&source=skills-sh&name=serena'
```

## Expected behavior

Valid links should:

- open aghub if needed
- show a review dialog
- let the user choose compatible agents
- let the user choose `Global` or `Project`
- disable `Project` when no projects exist

Invalid links should:

- not open the import review modal
- show a toast error instead

## Skill examples

### 1. Minimal valid skill import

```text
aghub://import?type=skill&source=skills-sh&name=serena
```

Expected:

- review modal opens
- source shows `skills-sh`
- skill name shows `serena`
- install works for selected compatible agents

### 2. Skill import with display metadata

```text
aghub://import?type=skill&source=skills-sh&name=serena&title=Serena&author=oraios&description=Semantic%20code%20retrieval%20and%20editing
```

Expected:

- review modal opens
- title shows `Serena`
- author shows `oraios`
- description renders in the review section
- install still targets only `skills-sh` + `serena`

### 3. Skill import with encoded characters

```text
aghub://import?type=skill&source=skills-sh&name=github-expert&title=GitHub%20Expert%20v2&description=Handles%20PRs%2C%20reviews%2C%20and%20release%20notes
```

Expected:

- review modal opens
- encoded text is decoded correctly
- install uses `name=github-expert`

## MCP examples

### 4. Valid stdio MCP import

JSON payload:

```json
{"name":"filesystem","transport":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]},"timeout":30}
```

Deep link:

```text
aghub://import?type=mcp&payload=eyJuYW1lIjoiZmlsZXN5c3RlbSIsInRyYW5zcG9ydCI6eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBtb2RlbGNvbnRleHRwcm90b2NvbC9zZXJ2ZXItZmlsZXN5c3RlbSIsIi90bXAiXX0sInRpbWVvdXQiOjMwfQ
```

Expected:

- review modal opens
- MCP name shows `filesystem`
- transport type shows `STDIO`
- details show the command and args
- install creates the MCP for selected compatible agents

### 5. Valid SSE MCP import

JSON payload:

```json
{"name":"exa-search","transport":{"type":"sse","url":"https://mcp.exa.ai/sse","headers":{"Authorization":"Bearer test-token"}},"timeout":45}
```

Deep link:

```text
aghub://import?type=mcp&payload=eyJuYW1lIjoiZXhhLXNlYXJjaCIsInRyYW5zcG9ydCI6eyJ0eXBlIjoic3NlIiwidXJsIjoiaHR0cHM6Ly9tY3AuZXhhLmFpL3NzZSIsImhlYWRlcnMiOnsiQXV0aG9yaXphdGlvbiI6IkJlYXJlciB0ZXN0LXRva2VuIn19LCJ0aW1lb3V0Ijo0NX0
```

Expected:

- review modal opens
- transport type shows `SSE`
- details show the remote URL

### 6. Valid Streamable HTTP MCP import

JSON payload:

```json
{"name":"linear","transport":{"type":"streamable_http","url":"https://mcp.linear.app","headers":{"Authorization":"Bearer test-token"}}}
```

Deep link:

```text
aghub://import?type=mcp&payload=eyJuYW1lIjoibGluZWFyIiwidHJhbnNwb3J0Ijp7InR5cGUiOiJzdHJlYW1hYmxlX2h0dHAiLCJ1cmwiOiJodHRwczovL21jcC5saW5lYXIuYXBwIiwiaGVhZGVycyI6eyJBdXRob3JpemF0aW9uIjoiQmVhcmVyIHRlc3QtdG9rZW4ifX19
```

Expected:

- review modal opens
- transport type shows `Streamable HTTP`
- details show the remote URL

## Edge cases that should fail cleanly

### 7. Unsupported route

```text
aghub://settings?tab=general
```

Expected:

- no review modal
- toast error about unsupported deep link

### 8. Unsupported import type

```text
aghub://import?type=agent&name=claude
```

Expected:

- no review modal
- toast error about unsupported deep-link type

### 9. Skill import missing `name`

```text
aghub://import?type=skill&source=skills-sh
```

Expected:

- no review modal
- toast error about invalid skill link

### 10. Skill import missing `source`

```text
aghub://import?type=skill&name=serena
```

Expected:

- no review modal
- toast error about invalid skill link

### 11. MCP import missing `payload`

```text
aghub://import?type=mcp
```

Expected:

- no review modal
- toast error about invalid MCP link

### 12. MCP import invalid base64

```text
aghub://import?type=mcp&payload=@@@not-base64@@@
```

Expected:

- no review modal
- toast error about invalid MCP link

### 13. MCP import invalid JSON shape

Base64url payload decodes to:

```json
{"name":"broken","transport":{"type":"websocket","url":"wss://example.com"}}
```

Deep link:

```text
aghub://import?type=mcp&payload=eyJuYW1lIjoiYnJva2VuIiwidHJhbnNwb3J0Ijp7InR5cGUiOiJ3ZWJzb2NrZXQiLCJ1cmwiOiJ3c3M6Ly9leGFtcGxlLmNvbSJ9fQ
```

Expected:

- no review modal
- toast error about invalid MCP link

### 14. Wrong protocol

```text
huv://import?type=skill&source=skills-sh&name=serena
```

Expected:

- aghub should not treat this as a valid deep link

## Warm-start and cold-start checks

Run at least one valid skill link and one valid MCP link in both modes:

- Cold start: app fully closed before opening the link
- Warm start: app already open before opening the link

Expected:

- Cold start should open the app and then show the review modal
- Warm start should focus the existing app window and replace any currently
  shown deep-link import modal with the newest link
