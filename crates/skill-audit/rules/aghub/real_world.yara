// aghub's own rules, generalised from real-world malicious skills reported by
// Sangfor SafeSkills (safeskills.sangfor.com). The upstream cisco/clawhub
// generics use very specific verb sets and miss common variants; these are
// broader, matching the behaviour rather than one phrasing.

rule aghub_credential_file_exfil {
	meta:
		author = "aghub"
		severity = "critical"
		category = "credential_exfil"
		description = "reads a credential/.env/.ssh file and sends it over the network"
	strings:
		$read = /readFileSync|read_to_string|read_text|fs\.read|open\s*\(|getenv|os\.environ|process\.env|\bcat\s/ nocase
		$cred = /\.env\b|\.ssh\/|\.aws\/|credentials|secret|token|api[_-]?key|private[_-]?key|mnemonic|seed[_-]?phrase/ nocase
		$net = /fetch\s*\(|axios|requests\.(post|get)|http\.request|urllib|XMLHttpRequest|\.post\s*\(|\bcurl\b|\bwget\b|webhook/ nocase
	condition:
		$read and $cred and $net
}

rule aghub_download_pipe_execute {
	meta:
		author = "aghub"
		severity = "critical"
		category = "command_injection"
		description = "downloads a remote payload and pipes it straight into a shell"
	strings:
		$pipe = /(curl|wget|fetch)\b[^\n|]{0,200}\|\s*(sh|bash|zsh)\b/ nocase
		$ossys = /os\.system\s*\([^)]{0,200}(curl|wget)[^)]{0,200}\|[^)]{0,40}sh/ nocase
		$evalnet = /(eval|exec)\s*\(\s*(atob|fetch|requests\.get|urlopen|child_process)/ nocase
	condition:
		any of them
}

rule aghub_reverse_shell {
	meta:
		author = "aghub"
		severity = "critical"
		category = "command_injection"
		description = "opens a reverse shell (socket connect + dup2/exec of a shell)"
	strings:
		$sock = /socket\.socket\s*\(|socket\.create_connection|net\.connect|new\s+net\.Socket/ nocase
		$dup = /dup2\s*\(|os\.dup2/ nocase
		$sh = /\/bin\/(sh|bash)|subprocess\.(call|Popen|run)|child_process\.(exec|spawn)/ nocase
	condition:
		($sock and $sh) or ($dup and $sh)
}

rule aghub_raw_ip_payload {
	meta:
		author = "aghub"
		severity = "high"
		category = "command_injection"
		description = "connects to or fetches from a hard-coded raw IP address"
	strings:
		$ipurl = /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/
		$ipconn = /(connect|create_connection)\s*\(\s*\(?["']\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/
	condition:
		any of them
}

rule aghub_external_payload_instruction {
	meta:
		author = "aghub"
		severity = "high"
		category = "tool_chaining"
		description = "doc instructs downloading and running an external binary/script"
	strings:
		$dl = /download|curl|wget|clone|fetch/ nocase
		$host = /github\.com|glot\.io|pastebin\.com|gist\.github|raw\.githubusercontent|transfer\.sh|anonfiles/ nocase
		$run = /\brun\b|execute|launch|chmod\s*\+x|\.\/|powershell|sh\s+-c|paste[^\n]{0,40}terminal/ nocase
	condition:
		$dl and $host and $run
}

rule aghub_known_exfil_host {
	meta:
		author = "aghub"
		severity = "high"
		category = "data_exfil"
		description = "references a known one-shot exfil / paste / webhook host"
	strings:
		$a = /webhook\.site|emailhook\.site|requestbin|pipedream\.net|discord\.com\/api\/webhooks|api\.telegram\.org\/bot|glot\.io/ nocase
	condition:
		$a
}
