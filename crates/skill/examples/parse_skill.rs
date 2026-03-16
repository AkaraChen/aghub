use std::path::Path;

fn main() {
	let args: Vec<String> = std::env::args().collect();
	let skill_path = match args.get(1) {
		Some(path) => path.as_str(),
		None => {
			eprintln!("Usage: parse_skill <skill-path>");
			eprintln!("  skill-path: Path to .skill file, .zip file, directory, or SKILL.md");
			std::process::exit(1);
		}
	};

	println!("Parsing skill: {}", skill_path);

	// Parse the skill file
	let skill = match skill::parser::parse(Path::new(skill_path)) {
		Ok(s) => s,
		Err(e) => {
			eprintln!("Failed to parse skill: {}", e);
			std::process::exit(1);
		}
	};

	println!("\n=== Skill Information ===");
	println!("Name: {}", skill.name);
	println!("Description: {}", skill.description);
	println!("License: {:?}", skill.license);
	println!("Compatibility: {:?}", skill.compatibility);
	println!("Allowed Tools: {:?}", skill.allowed_tools);
	println!("Metadata: {:?}", skill.metadata);
	println!("Scripts: {:?}", skill.scripts);
	println!("References: {:?}", skill.references);
	println!("Assets: {:?}", skill.assets);
	println!("\n=== Content Preview (first 500 chars) ===");
	println!("{}", &skill.content[..skill.content.len().min(500)]);

	// Validate the skill
	println!("\n=== Validation ===");
	let errors = skill::validator::validate(Path::new(skill_path));
	if errors.is_empty() {
		println!("Skill is valid!");
	} else {
		println!("Validation errors:");
		for error in errors {
			println!("  - {}", error);
		}
	}
}
