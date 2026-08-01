//! The compiled YARA rule set, built once per process and cached.
//!
//! Rules are embedded at compile time and compiled on first use. cisco rules
//! (Apache-2.0) and clawhub-derived rules (MIT) live under `rules/`; see
//! `rules/NOTICE.md` for attribution.

use std::sync::OnceLock;

use crate::{report::hash_part, AuditError};
use sha2::{Digest, Sha256};
use yara_x::Rules;

const RULESET_FINGERPRINT_DOMAIN: &[u8] = b"aghub-skill-audit-ruleset-v1";

/// Every bundled rule source, embedded into the binary at compile time.
const RULE_SOURCES: &[&str] = &[
	// cisco-ai-defense/skill-scanner (Apache-2.0)
	include_str!("../rules/cisco/autonomy_abuse_generic.yara"),
	include_str!("../rules/cisco/capability_inflation_generic.yara"),
	include_str!("../rules/cisco/code_execution_generic.yara"),
	include_str!("../rules/cisco/coercive_injection_generic.yara"),
	include_str!("../rules/cisco/command_injection_generic.yara"),
	include_str!("../rules/cisco/credential_harvesting_generic.yara"),
	include_str!("../rules/cisco/embedded_binary_detection.yara"),
	include_str!("../rules/cisco/indirect_prompt_injection_generic.yara"),
	include_str!("../rules/cisco/prompt_injection_generic.yara"),
	include_str!("../rules/cisco/prompt_injection_unicode_steganography.yara"),
	include_str!("../rules/cisco/script_injection_generic.yara"),
	include_str!("../rules/cisco/sql_injection_generic.yara"),
	include_str!("../rules/cisco/system_manipulation_generic.yara"),
	include_str!("../rules/cisco/tool_chaining_abuse_generic.yara"),
	// openclaw/clawhub, rewritten to YARA (MIT)
	include_str!("../rules/clawhub/agent_specific.yara"),
	// aghub's own rules, generalised from real-world SafeSkills samples
	include_str!("../rules/aghub/real_world.yara"),
	// aghub data-flow correlation (source/sink for cross-file chains)
	include_str!("../rules/aghub/dataflow.yara"),
];

static RULES: OnceLock<Result<Rules, String>> = OnceLock::new();
static RULESET_FINGERPRINT: OnceLock<[u8; 32]> = OnceLock::new();

pub(crate) fn fingerprint() -> &'static [u8; 32] {
	RULESET_FINGERPRINT.get_or_init(|| {
		let mut hasher = Sha256::new();
		hash_part(&mut hasher, RULESET_FINGERPRINT_DOMAIN);
		for source in RULE_SOURCES {
			hash_part(&mut hasher, source.as_bytes());
		}
		hasher.finalize().into()
	})
}

/// The process-wide compiled rule set (compiled on first access).
pub fn rules() -> Result<&'static Rules, AuditError> {
	RULES
		.get_or_init(compile_rules)
		.as_ref()
		.map_err(|error| AuditError::RuleCompilation(error.clone()))
}

fn compile_rules() -> Result<Rules, String> {
	let mut compiler = yara_x::Compiler::new();
	for src in RULE_SOURCES {
		compiler
			.add_source(*src)
			.map_err(|error| error.to_string())?;
	}
	Ok(compiler.build())
}

#[cfg(test)]
mod tests {
	const MODIFICATION_NOTICE: &str =
		"// Modified by aghub; see ../SOURCES.toml for the pinned upstream source.";
	const MODIFIED_CISCO_RULES: &[(&str, &str)] = &[
		(
			"cisco/code_execution_generic.yara",
			include_str!("../rules/cisco/code_execution_generic.yara"),
		),
		(
			"cisco/credential_harvesting_generic.yara",
			include_str!("../rules/cisco/credential_harvesting_generic.yara"),
		),
		(
			"cisco/embedded_binary_detection.yara",
			include_str!("../rules/cisco/embedded_binary_detection.yara"),
		),
		(
			"cisco/prompt_injection_generic.yara",
			include_str!("../rules/cisco/prompt_injection_generic.yara"),
		),
		(
			"cisco/script_injection_generic.yara",
			include_str!("../rules/cisco/script_injection_generic.yara"),
		),
		(
			"cisco/system_manipulation_generic.yara",
			include_str!("../rules/cisco/system_manipulation_generic.yara"),
		),
		(
			"cisco/tool_chaining_abuse_generic.yara",
			include_str!("../rules/cisco/tool_chaining_abuse_generic.yara"),
		),
	];

	#[test]
	fn modified_cisco_rules_are_identified_and_pinned() {
		let provenance = include_str!("../rules/SOURCES.toml");
		for (path, source) in MODIFIED_CISCO_RULES {
			assert!(source.starts_with(MODIFICATION_NOTICE), "{path}");
			assert!(
				provenance.contains(&format!("local = \"{path}\"")),
				"{path}"
			);
		}
		for revision in [
			"543ecf42167e8c0404e73c1e4d748bf43663b786",
			"cc16d7fbd9244da6736220e1d7cacb69c02a5a31",
		] {
			assert!(provenance.contains(revision));
		}
	}
}
