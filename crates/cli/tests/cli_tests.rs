use assert_cmd::Command;
use serde_json::Value;
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
	PathBuf::from(env!("CARGO_MANIFEST_DIR"))
		.join("../../fixtures")
		.canonicalize()
		.unwrap()
}

fn agentctl() -> Command {
	Command::cargo_bin("agentctl").unwrap()
}

#[test]
fn test_agent_all_get_skills_is_valid_json_array() {
	let dir = fixtures_dir();
	let out = agentctl()
		.current_dir(&dir)
		.args(["--agent", "all", "--all", "get", "skills"])
		.output()
		.unwrap();

	assert!(
		out.status.success(),
		"stderr: {}",
		String::from_utf8_lossy(&out.stderr)
	);

	let json: Value = serde_json::from_slice(&out.stdout)
		.expect("stdout must be valid JSON");
	let arr = json.as_array().expect("output must be a JSON array");
	assert!(!arr.is_empty(), "array must not be empty");

	for entry in arr {
		assert!(entry["agent"].is_string(), "each entry must have 'agent'");
		assert!(entry["skills"].is_array(), "each entry must have 'skills'");
	}

	// Cline has universal_skills + project_skills_path = root/.agents/skills
	// fixtures/.cline/ makes fixtures/ the project root, so cline sees:
	// fixtures/.agents/skills/vercel-react-best-practices/SKILL.md
	let cline = arr
		.iter()
		.find(|e| e["agent"] == "cline")
		.expect("must have cline entry");
	let skills = cline["skills"].as_array().unwrap();
	assert!(
		skills.iter().any(|s| s["name"] == "vercel-react-best-practices"),
		"cline must see vercel-react-best-practices from fixtures/.agents/skills"
	);
}

#[test]
fn test_agent_all_get_mcps_is_valid_json_array() {
	let dir = fixtures_dir();
	let out = agentctl()
		.current_dir(&dir)
		.args(["--agent", "all", "--all", "get", "mcps"])
		.output()
		.unwrap();

	assert!(
		out.status.success(),
		"stderr: {}",
		String::from_utf8_lossy(&out.stderr)
	);

	let json: Value = serde_json::from_slice(&out.stdout)
		.expect("stdout must be valid JSON");
	let arr = json.as_array().expect("output must be a JSON array");
	assert!(!arr.is_empty(), "array must not be empty");

	for entry in arr {
		assert!(entry["agent"].is_string(), "each entry must have 'agent'");
		assert!(entry["mcps"].is_array(), "each entry must have 'mcps'");
	}
}

#[test]
fn test_agent_all_non_get_command_fails() {
	let out = agentctl()
		.args(["--agent", "all", "add", "skills", "--name", "foo"])
		.output()
		.unwrap();

	assert!(
		!out.status.success(),
		"--agent all with add should fail"
	);
	let stderr = String::from_utf8_lossy(&out.stderr);
	assert!(
		stderr.contains("all") || stderr.contains("get"),
		"error must mention the restriction, got: {}",
		stderr
	);
}
