pub(super) fn is_semantic_version(ver: &str) -> bool {
	ver.chars()
		.next()
		.map(|c| c.is_ascii_digit())
		.unwrap_or(false)
		&& ver.contains('.')
}

pub(super) fn compare_versions(a: &str, b: &str) -> i32 {
	let a_clean = a.split('+').next().unwrap_or(a);
	let b_clean = b.split('+').next().unwrap_or(b);

	match (
		semver::Version::parse(a_clean),
		semver::Version::parse(b_clean),
	) {
		(Ok(a_ver), Ok(b_ver)) => match a_ver.cmp(&b_ver) {
			std::cmp::Ordering::Less => -1,
			std::cmp::Ordering::Equal => 0,
			std::cmp::Ordering::Greater => 1,
		},
		_ => {
			let parse = |s: &str| {
				s.split('.')
					.filter_map(|part| part.parse::<u32>().ok())
					.collect::<Vec<_>>()
			};

			let a_parts = parse(a);
			let b_parts = parse(b);

			for (a_part, b_part) in a_parts.iter().zip(b_parts.iter()) {
				match a_part.cmp(b_part) {
					std::cmp::Ordering::Less => return -1,
					std::cmp::Ordering::Greater => return 1,
					std::cmp::Ordering::Equal => continue,
				}
			}

			match a_parts.len().cmp(&b_parts.len()) {
				std::cmp::Ordering::Less => -1,
				std::cmp::Ordering::Equal => 0,
				std::cmp::Ordering::Greater => 1,
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_compare_versions() {
		assert_eq!(compare_versions("1.0.0", "1.0.0"), 0);
		assert_eq!(compare_versions("1.1.0", "1.0.0"), 1);
		assert_eq!(compare_versions("1.0.0", "1.1.0"), -1);
		assert_eq!(compare_versions("2.0.0", "1.9.9"), 1);
		assert_eq!(compare_versions("1.0.0-alpha", "1.0.0"), -1);
		assert_eq!(compare_versions("1.0.0-beta", "1.0.0-alpha"), 1);
		assert_eq!(compare_versions("1.0.0+build1", "1.0.0+build2"), 0);
		assert_eq!(compare_versions("1.0", "1.0.0"), -1);
		assert_eq!(compare_versions("1.0.0", "1.0"), 1);
		assert_eq!(compare_versions("1.2", "1.10"), -1);
		assert_eq!(compare_versions("abc", "def"), 0);
	}

	#[test]
	fn test_is_semantic_version() {
		assert!(is_semantic_version("1.0.0"));
		assert!(is_semantic_version("2.1.0-beta"));
		assert!(!is_semantic_version("abc123"));
		assert!(!is_semantic_version("latest"));
	}
}
