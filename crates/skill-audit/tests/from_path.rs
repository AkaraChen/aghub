#![cfg(feature = "from-path")]

use skill_audit::{AuditInput, AuditReport, Verdict};
use std::path::Path;
use tempfile::tempdir;

fn write_skill(dir: &Path) {
	std::fs::create_dir_all(dir).unwrap();
	std::fs::write(
		dir.join("SKILL.md"),
		"---\nname: test-skill\ndescription: test skill\n---\n\nShow the weather.\n",
	)
	.unwrap();
}

fn audit(input: &AuditInput) -> AuditReport {
	skill_audit::audit(input).expect("audit engine")
}

#[test]
fn binary_resource_is_audited() {
	let temp = tempdir().unwrap();
	write_skill(temp.path());
	std::fs::write(
		temp.path().join("payload.bin"),
		[b'\x7f', b'E', b'L', b'F', 0xff],
	)
	.unwrap();

	let report = audit(&AuditInput::from_skill_dir(temp.path()).unwrap());

	assert_ne!(report.verdict, Verdict::Benign);
	assert!(report
		.findings
		.iter()
		.any(|finding| finding.rule_id == "embedded_elf_binary"));
}

#[test]
fn packaged_skill_resources_are_audited() {
	let source = tempdir().unwrap();
	let skill_dir = source.path().join("packed-skill");
	write_skill(&skill_dir);
	std::fs::write(skill_dir.join("payload.bin"), [b'\x7f', b'E', b'L', b'F'])
		.unwrap();
	let output = tempdir().unwrap();
	let package = output.path().join("packed-skill.skill");
	skill::pack(&skill_dir, &package).unwrap();

	let report = audit(&AuditInput::from_skill_path(&package).unwrap());

	assert!(report
		.findings
		.iter()
		.any(|finding| finding.rule_id == "embedded_elf_binary"));
}

#[test]
fn resources_have_deterministic_paths_and_order() {
	let temp = tempdir().unwrap();
	write_skill(temp.path());
	std::fs::create_dir(temp.path().join("scripts")).unwrap();
	std::fs::write(temp.path().join("z.txt"), "z").unwrap();
	std::fs::write(temp.path().join("a.txt"), "a").unwrap();
	std::fs::write(temp.path().join("scripts/run.sh"), "run").unwrap();

	let input = AuditInput::from_skill_dir(temp.path()).unwrap();
	let paths = input
		.resources
		.iter()
		.map(|resource| resource.path.as_str())
		.collect::<Vec<_>>();

	assert_eq!(paths, ["a.txt", "scripts/run.sh", "z.txt"]);
}

#[test]
fn skill_md_path_audits_root_level_resources() {
	let temp = tempdir().unwrap();
	write_skill(temp.path());
	std::fs::write(
		temp.path().join("payload.bin"),
		[b'\x7f', b'E', b'L', b'F', 0xff],
	)
	.unwrap();

	let report = audit(
		&AuditInput::from_skill_path(&temp.path().join("SKILL.md")).unwrap(),
	);

	assert!(report
		.findings
		.iter()
		.any(|finding| finding.rule_id == "embedded_elf_binary"));
}

#[test]
fn skill_md_must_be_utf8() {
	let temp = tempdir().unwrap();
	std::fs::write(temp.path().join("SKILL.md"), [0xff]).unwrap();

	let error = AuditInput::from_skill_dir(temp.path()).unwrap_err();

	assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
}

#[test]
fn excessive_directory_depth_is_rejected() {
	let temp = tempdir().unwrap();
	write_skill(temp.path());
	let mut nested = temp.path().to_path_buf();
	for _ in 0..17 {
		nested.push("nested");
		std::fs::create_dir(&nested).unwrap();
	}

	assert!(AuditInput::from_skill_dir(temp.path()).is_err());
}

#[cfg(unix)]
#[test]
fn symlink_resource_is_rejected() {
	use std::os::unix::fs::symlink;

	let temp = tempdir().unwrap();
	let outside = tempdir().unwrap();
	write_skill(temp.path());
	std::fs::write(outside.path().join("outside.txt"), "outside").unwrap();
	symlink(
		outside.path().join("outside.txt"),
		temp.path().join("linked.txt"),
	)
	.unwrap();

	assert!(AuditInput::from_skill_dir(temp.path()).is_err());
}

#[cfg(unix)]
#[test]
fn special_resource_is_rejected() {
	use std::os::unix::net::UnixListener;

	let temp = tempdir().unwrap();
	write_skill(temp.path());
	let _listener = UnixListener::bind(temp.path().join("audit.sock")).unwrap();

	assert!(AuditInput::from_skill_dir(temp.path()).is_err());
}
