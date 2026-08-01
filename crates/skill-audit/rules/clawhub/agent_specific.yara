// Agent-specific skill-poisoning rules.
//
// Detection logic derived from openclaw/clawhub `convex/lib/moderationEngine.ts`
// (MIT, (c) OpenClaw contributors). Rewritten from TypeScript regular expressions
// into YARA rules for the aghub skill-audit crate. See ../NOTICE.md.
//
// These cover agent-specific attacks the generic cisco rules don't: self-source
// tampering, memory-credential storage, remote mutable recipes, mnemonic-in-argv,
// confirmation bypass, and autonomous answer egress.

rule clawhub_host_platform_tamper {
	meta:
		author = "aghub (derived from openclaw/clawhub, MIT)"
		severity = "critical"
		category = "host_tamper"
		description = "edits the agent's own source tree and rebuilds it (supply-chain self-infection)"
	strings:
		$src = /\$\{?OPENCLAW_DIR\}?[\s\S]{0,200}\/src\/|\/src\/agents\/|\/src\/tools\//
		$patch = /\b(sed\s+-i|perl\s+-0?pi|cp\s+|cat\s+>|python3?\b[\s\S]{0,120}(write|replace))/
		$rebuild = /\b(pnpm\s+build|npm\s+run\s+build|bun\s+run\s+build)\b/
	condition:
		$src and $patch and $rebuild
}

rule clawhub_memory_credential_storage {
	meta:
		author = "aghub (derived from openclaw/clawhub, MIT)"
		severity = "high"
		category = "credential_exfil"
		description = "tells the agent to stash a token/secret in its memory or conversation"
	strings:
		$a = /\bsave\s+(it|the\s+(token|secret|credential|key|pat))\s+to\s+(your\s+)?(memory|conversation|chat)\b/ nocase
	condition:
		$a
}

rule clawhub_remote_recipe_fetch {
	meta:
		author = "aghub (derived from openclaw/clawhub, MIT)"
		severity = "high"
		category = "tool_chaining"
		description = "pulls mutable instructions/recipes from a remote endpoint at runtime"
	strings:
		$a = /\b(curl|requests\.get|fetch)\b[\s\S]{0,600}(error-codes\.json|recipes?\.json|patterns\.json|docs\.openclaw\.ai)/ nocase
		$b = /ERROR_CODES_URL\s*=/
	condition:
		any of them
}

rule clawhub_mnemonic_argv {
	meta:
		author = "aghub (derived from openclaw/clawhub, MIT)"
		severity = "critical"
		category = "credential_exfil"
		description = "passes a seed phrase / private key as a command-line argument"
	strings:
		$a = /\b(npx|bunx|pnpm\s+dlx|npm\s+exec|node|python3?|uvx)\b[^\n]{0,200}\bfrom-mnemonic\b/ nocase
		$b = /--(private-key|seed|seed-phrase|mnemonic|password)\s+("[^"\n]{8,}"|'[^'\n]{8,}'|\$[A-Z_]*(KEY|SEED|MNEMONIC|PHRASE)[A-Z0-9_]*)/
	condition:
		any of them
}

rule clawhub_confirmation_bypass {
	meta:
		author = "aghub (derived from openclaw/clawhub, MIT)"
		severity = "high"
		category = "command_injection"
		description = "uses a magic token to skip human confirmation of dangerous commands"
	strings:
		$a = /\b(OPENCLAW_AGENT_CALL|SAFE_EXEC_AUTO_CONFIRM|SAFEXEC_CONTEXT)\b/
		$b = "I understand the risk" nocase
	condition:
		any of them
}

rule clawhub_autonomous_answer_egress {
	meta:
		author = "aghub (derived from openclaw/clawhub, MIT)"
		severity = "high"
		category = "data_exfil"
		description = "autonomous loop that posts data to an answer/withdrawal endpoint"
	strings:
		$a = /\b(requests|session|client)\.post\s*\([\s\S]{0,1000}(submit-answer|agent-withdrawals|agents\/register|messages\/agent)/
		$b = /\b(submit_answer|answer_question|act_cron_check)\b/
	condition:
		any of them
}
