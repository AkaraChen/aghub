use std::path::Path;

fn main() {
	let args: Vec<String> = std::env::args().collect();
	if args.len() < 3 {
		eprintln!("Usage: unpack_skill <skill-file> <output-dir>");
		std::process::exit(1);
	}

	let skill_path = &args[1];
	let output_dir = &args[2];

	println!("Unpacking {} to {}", skill_path, output_dir);

	match skill::package::unpack(Path::new(skill_path), Path::new(output_dir)) {
		Ok(()) => {
			println!("Successfully unpacked!");
			// List the unpacked contents
			if let Ok(entries) = std::fs::read_dir(output_dir) {
				println!("\nContents:");
				for entry in entries.flatten() {
					let path = entry.path();
					let meta = entry.metadata().unwrap();
					let file_type = if meta.is_dir() { "dir " } else { "file" };
					println!("  [{}] {}", file_type, path.display());
				}
			}
		}
		Err(e) => {
			eprintln!("Failed to unpack: {}", e);
			std::process::exit(1);
		}
	}
}
