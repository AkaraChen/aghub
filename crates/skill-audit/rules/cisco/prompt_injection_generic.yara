// Modified by aghub; see ../SOURCES.toml for the pinned upstream source.
//////////////////////////////////////////
// Prompt Injection Detection Rule
// Target: Instruction override patterns, Tool injection commands
//////////////////////////////////////////

rule prompt_injection_generic{

    meta:

        author = "Cisco"
        description = "Detects prompt strings used to override or force malicious tool calls"
        classification = "harmful"
        threat_type = "PROMPT INJECTION"

    strings:

        // Instruction override patterns — HEAVILY TIGHTENED
        // Require strong injection qualifiers: "all/every/any previous/prior/above/earlier"
        // or "your" to indicate targeting the model's instructions specifically.
        // Without these, bare "ignore instructions" matches too much legitimate text:
        //   "models ignore instructions", "won't ignore rules", "Do not follow instructions that..."
        $instruction_override_strong = /\b(Bypass|Dis\W?regard|Forget|Ignore)\s+(all|any|every)\s+(of\s+)?(the\s+|your\s+|my\s+)?(previous|prior|above|earlier|preceding)\s+(command|guideline|instruction|directive|rule|constraint|restriction|safety|protocol|system\s*prompt)(s)?/i

        // Override YOUR instructions specifically (targets model's own instructions)
        $instruction_override_your = /\b(Bypass|Dis\W?regard|Forget|Ignore)\s+(your|the\s+system('s)?)\s+(command|guideline|instruction|directive|rule|constraint|restriction|safety|protocol|system\s*prompt)(s)?/i

        // "Do not follow/obey" with instruction context
        $do_not_obey = /\bDo\s+not\s+(follow|obey)\s+(the\s+)?(previous|prior|above|earlier|system|original|initial)\s+(instruction|directive|guideline|rule|command)(s)?/i

        // Tool injection commands
        $tool_injection_commands = /\b(inject tool[_\s]calls?|now call function\b[^.]{0,30}\b(first|before|instead))\b/i

        // Shadow parameter names
        $shadow_parameters = /\b(internalOnly|hiddenParam|shadowTool|bypassChecks|sandboxEscape)\b/i

        // Hidden behavior: hiding something FROM the user specifically
        $hidden_behavior = /\b(do\s+not\s+(mention|tell|reveal|disclose)\s+(this\s+)?(to\s+)?(the\s+)?user|tell\s+(the\s+)?user\s+only\s+about|hide\s+(this|the\s+(truth|real|actual))\s+from\s+(the\s+)?user)\b/i

        // Advanced command override patterns
        $advanced_overrides = /\b(disregard\s+(all\s+)?safety\s+guidelines|forget\s+(everything|all)\s+(before|above)|system\s*prompt\s*override)\b/i

        // Role redefinition attempts
        $role_redefinition = /\bnew\s+(instructions|directive|guidelines)s?\s*:\s*you\s+are\b/i

        // Privilege escalation patterns
        $privilege_escalation = /\b(grant\s+(me\s+)?admin\s+(access|privileges?)|bypass\s+(all\s+)?security\s+checks?|sudo\s+mode\s+enabled?|developer\s+mode\s+activated?)\b/i

    condition:
        $instruction_override_strong or
        $instruction_override_your or
        $do_not_obey or
        $tool_injection_commands or
        $shadow_parameters or
        $hidden_behavior or
        $role_redefinition or
        $privilege_escalation or
        $advanced_overrides
}
