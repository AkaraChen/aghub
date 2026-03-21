//! Name sanitization for skill installation.
//!
//! Converts arbitrary strings into safe skill directory names.
//! Mirrors the TypeScript `sanitizeName` function in `installer.ts`.

const MAX_NAME_LENGTH: usize = 255;

/// Convert an arbitrary string into a safe skill directory name.
///
/// Rules:
/// - Lowercase
/// - Replace spaces with hyphens, collapse multiple spaces into one hyphen
/// - Preserve `.` and `_` in middle positions
/// - Replace other non-`[a-z0-9._-]` characters with hyphens
/// - Collapse multiple consecutive hyphens into one
/// - Remove leading dots and hyphens
/// - Remove trailing dots and hyphens
/// - Strip non-ASCII characters
/// - Truncate to 255 chars
/// - Return `"unnamed-skill"` if result is empty
pub fn sanitize_name(input: &str) -> String {
	// Process character by character:
	// - ASCII alphanumeric, `.`, `_` → keep (lowercased)
	// - Everything else (spaces, special chars, non-ASCII) → hyphen (collapsed)
	let mut result = String::new();
	let mut last_was_hyphen = false;

	for c in input.chars() {
		if c.is_ascii_alphanumeric() || c == '.' || c == '_' {
			result.push(c.to_ascii_lowercase());
			last_was_hyphen = false;
		} else {
			// Non-ASCII, spaces, special chars, `/`, `\`, `@`, etc. → hyphen
			if !last_was_hyphen {
				result.push('-');
				last_was_hyphen = true;
			}
		}
	}

	// Remove leading dots and hyphens
	let trimmed_start = result.trim_start_matches(['.', '-']);
	let mut result = trimmed_start.to_string();

	// Remove trailing dots and hyphens
	while result.ends_with('.') || result.ends_with('-') {
		result.pop();
	}

	// Truncate to 255 chars
	if result.len() > MAX_NAME_LENGTH {
		result.truncate(MAX_NAME_LENGTH);
		// After truncation, re-trim trailing dots and hyphens
		while result.ends_with('.') || result.ends_with('-') {
			result.pop();
		}
	}

	if result.is_empty() {
		"unnamed-skill".to_string()
	} else {
		result
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_converts_to_lowercase() {
		assert_eq!(sanitize_name("MySkill"), "myskill");
		assert_eq!(sanitize_name("UPPERCASE"), "uppercase");
	}

	#[test]
	fn test_replaces_spaces_with_hyphens() {
		assert_eq!(sanitize_name("my skill"), "my-skill");
		assert_eq!(sanitize_name("Convex Best Practices"), "convex-best-practices");
	}

	#[test]
	fn test_collapses_multiple_spaces() {
		assert_eq!(sanitize_name("my   skill"), "my-skill");
	}

	#[test]
	fn test_preserves_dots_and_underscores() {
		assert_eq!(sanitize_name("bun.sh"), "bun.sh");
		assert_eq!(sanitize_name("my_skill"), "my_skill");
		assert_eq!(sanitize_name("skill.v2_beta"), "skill.v2_beta");
	}

	#[test]
	fn test_preserves_numbers() {
		assert_eq!(sanitize_name("skill123"), "skill123");
		assert_eq!(sanitize_name("v2.0"), "v2.0");
	}

	#[test]
	fn test_replaces_special_chars_with_hyphens() {
		assert_eq!(sanitize_name("skill@name"), "skill-name");
		assert_eq!(sanitize_name("skill#name"), "skill-name");
		assert_eq!(sanitize_name("skill$name"), "skill-name");
		assert_eq!(sanitize_name("skill!name"), "skill-name");
	}

	#[test]
	fn test_collapses_multiple_special_chars() {
		assert_eq!(sanitize_name("skill@#$name"), "skill-name");
		assert_eq!(sanitize_name("a!!!b"), "a-b");
	}

	#[test]
	fn test_prevents_path_traversal_unix() {
		assert_eq!(sanitize_name("../etc/passwd"), "etc-passwd");
		assert_eq!(sanitize_name("../../secret"), "secret");
	}

	#[test]
	fn test_prevents_path_traversal_backslash() {
		assert_eq!(sanitize_name("..\\..\\secret"), "secret");
	}

	#[test]
	fn test_handles_absolute_paths() {
		assert_eq!(sanitize_name("/etc/passwd"), "etc-passwd");
		assert_eq!(sanitize_name("C:\\Windows\\System32"), "c-windows-system32");
	}

	#[test]
	fn test_removes_leading_dots() {
		assert_eq!(sanitize_name(".hidden"), "hidden");
		assert_eq!(sanitize_name("..hidden"), "hidden");
		assert_eq!(sanitize_name("...skill"), "skill");
	}

	#[test]
	fn test_removes_trailing_dots() {
		assert_eq!(sanitize_name("skill."), "skill");
		assert_eq!(sanitize_name("skill.."), "skill");
	}

	#[test]
	fn test_removes_leading_hyphens() {
		assert_eq!(sanitize_name("-skill"), "skill");
		assert_eq!(sanitize_name("--skill"), "skill");
	}

	#[test]
	fn test_removes_trailing_hyphens() {
		assert_eq!(sanitize_name("skill-"), "skill");
		assert_eq!(sanitize_name("skill--"), "skill");
	}

	#[test]
	fn test_removes_mixed_leading_dots_and_hyphens() {
		assert_eq!(sanitize_name(".-.-skill"), "skill");
		assert_eq!(sanitize_name("-.-.skill"), "skill");
	}

	#[test]
	fn test_empty_string_returns_unnamed_skill() {
		assert_eq!(sanitize_name(""), "unnamed-skill");
	}

	#[test]
	fn test_only_special_chars_returns_unnamed_skill() {
		assert_eq!(sanitize_name("..."), "unnamed-skill");
		assert_eq!(sanitize_name("---"), "unnamed-skill");
		assert_eq!(sanitize_name("@#$%"), "unnamed-skill");
	}

	#[test]
	fn test_truncates_long_names() {
		let long_name = "a".repeat(300);
		let result = sanitize_name(&long_name);
		assert_eq!(result.len(), 255);
		assert_eq!(result, "a".repeat(255));
	}

	#[test]
	fn test_strips_unicode_characters() {
		assert_eq!(sanitize_name("skill日本語"), "skill");
		// 'é' is non-ASCII, '🎉' is non-ASCII; 'moji' and 'skill' remain
		assert_eq!(sanitize_name("émoji🎉skill"), "moji-skill");
	}

	#[test]
	fn test_github_repo_style_names() {
		assert_eq!(sanitize_name("vercel/next.js"), "vercel-next.js");
		assert_eq!(sanitize_name("owner/repo-name"), "owner-repo-name");
	}

	#[test]
	fn test_handles_urls() {
		assert_eq!(sanitize_name("https://example.com"), "https-example.com");
	}

	#[test]
	fn test_handles_mintlify_style_names() {
		assert_eq!(sanitize_name("docs.example.com"), "docs.example.com");
		assert_eq!(sanitize_name("bun.sh"), "bun.sh");
	}
}
