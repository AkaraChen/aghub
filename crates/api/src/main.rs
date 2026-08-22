use aghub_api::{start, ApiOptions};

fn apply_environment(
	options: &mut ApiOptions,
	read: impl Fn(&str) -> Option<String>,
) {
	if let Some(data_dir) =
		read("AGHUB_API_DATA_DIR").filter(|value| !value.trim().is_empty())
	{
		options.app_data_dir = Some(data_dir.into());
	}
	if let Some(origin) = read("AGHUB_API_ALLOWED_ORIGIN")
		.filter(|value| !value.trim().is_empty())
	{
		options.allowed_origins.push(origin);
	}
}

/// Standalone server entry. Environment overrides let desktop E2E instances
/// use independent ports, data roots, origins, and fixture ccusage binaries.
#[tokio::main]
async fn main() {
	let port = std::env::var("AGHUB_API_PORT")
		.ok()
		.and_then(|value| value.parse().ok())
		.unwrap_or(8000);
	let mut options = ApiOptions::new(port);
	apply_environment(&mut options, |name| std::env::var(name).ok());
	start(options).await.expect("server error");
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn applies_isolated_data_dir_and_allowed_origin() {
		let mut options = ApiOptions::new(46001);
		apply_environment(&mut options, |name| match name {
			"AGHUB_API_DATA_DIR" => Some("/tmp/aghub-e2e-46001".to_string()),
			"AGHUB_API_ALLOWED_ORIGIN" => {
				Some("http://localhost:1430".to_string())
			}
			_ => None,
		});
		assert_eq!(options.app_data_dir, Some("/tmp/aghub-e2e-46001".into()));
		assert!(options
			.allowed_origins
			.iter()
			.any(|origin| origin == "http://localhost:1430"));
	}
}
