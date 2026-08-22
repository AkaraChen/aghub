/// Extract `{{ variable }}` placeholder names from prompt content, trimmed,
/// de-duplicated, and in first-seen order.
///
/// A placeholder is any run of text between `{{` and the next `}}`. Empty or
/// whitespace-only placeholders are ignored.
pub fn extract_variables(content: &str) -> Vec<String> {
	let mut variables = Vec::new();
	let mut rest = content;

	while let Some(open) = rest.find("{{") {
		rest = &rest[open + 2..];
		let Some(close) = rest.find("}}") else {
			break;
		};
		let name = rest[..close].trim();
		rest = &rest[close + 2..];

		if name.is_empty() || variables.iter().any(|seen| seen == name) {
			continue;
		}
		variables.push(name.to_string());
	}

	variables
}

#[cfg(test)]
mod tests {
	use super::extract_variables;

	#[test]
	fn extracts_trimmed_unique_in_order() {
		let content =
			"Hi {{ name }}, your {{role}} at {{ company }}. Bye {{name}}.";
		assert_eq!(
			extract_variables(content),
			vec![
				"name".to_string(),
				"role".to_string(),
				"company".to_string(),
			]
		);
	}

	#[test]
	fn ignores_empty_and_unclosed() {
		assert!(extract_variables("no placeholders here").is_empty());
		assert!(extract_variables("{{   }} {{").is_empty());
	}
}
