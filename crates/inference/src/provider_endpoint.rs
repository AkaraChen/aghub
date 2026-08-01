use url::Url;

use crate::{
	InferenceProvider, InferenceProviderError, InferenceProviderFormat,
};

fn inferred_api_base_url_scheme(value: &str) -> &'static str {
	let Ok(url) = Url::parse(&format!("http://{value}")) else {
		return "https";
	};
	match url.host() {
		Some(url::Host::Domain(host))
			if host.eq_ignore_ascii_case("localhost")
				|| host.to_ascii_lowercase().ends_with(".localhost") =>
		{
			"http"
		}
		Some(url::Host::Ipv4(address))
			if address.is_loopback() || address.is_unspecified() =>
		{
			"http"
		}
		Some(url::Host::Ipv6(address)) if address.is_loopback() => "http",
		_ => "https",
	}
}

#[derive(Debug)]
pub(crate) enum ProviderEndpointError {
	Empty,
	Invalid,
	Unsupported,
}

impl From<ProviderEndpointError> for InferenceProviderError {
	fn from(error: ProviderEndpointError) -> Self {
		match error {
			ProviderEndpointError::Empty => Self::EmptyApiBaseUrl,
			ProviderEndpointError::Invalid => Self::InvalidApiBaseUrl,
			ProviderEndpointError::Unsupported => Self::UnsupportedApiBaseUrl,
		}
	}
}

fn parse_api_base_url(
	api_base_url: &str,
) -> Result<Url, ProviderEndpointError> {
	let value = api_base_url.trim();
	if value.is_empty() {
		return Err(ProviderEndpointError::Empty);
	}
	let candidate = if value.contains("://") {
		value.to_string()
	} else {
		format!("{}://{value}", inferred_api_base_url_scheme(value))
	};
	let mut url =
		Url::parse(&candidate).map_err(|_| ProviderEndpointError::Invalid)?;
	if !matches!(url.scheme(), "http" | "https")
		|| url.cannot_be_a_base()
		|| url.host().is_none()
		|| !url.username().is_empty()
		|| url.password().is_some()
	{
		return Err(ProviderEndpointError::Unsupported);
	}
	let path = url.path().trim_end_matches('/').to_string();
	url.set_path(if path.is_empty() { "/" } else { &path });
	url.set_fragment(None);
	Ok(url)
}

fn strip_request_endpoint_suffix(path: &str) -> &str {
	const SUFFIXES: [&str; 5] = [
		"/chat/completions",
		"/completions",
		"/responses",
		"/messages",
		"/models",
	];
	for suffix in SUFFIXES {
		if let Some(base) = path.strip_suffix(suffix) {
			return base;
		}
	}
	path
}

fn normalized_provider_api_base_url(
	api_base_url: &str,
) -> Result<Url, ProviderEndpointError> {
	let mut url = parse_api_base_url(api_base_url)?;
	let api_path =
		strip_request_endpoint_suffix(url.path().trim_end_matches('/'))
			.to_string();
	url.set_path(if api_path.is_empty() { "/" } else { &api_path });
	Ok(url)
}

pub(crate) fn normalize_provider_api_base_url(
	api_base_url: &str,
) -> Result<String, ProviderEndpointError> {
	let url = normalized_provider_api_base_url(api_base_url)?;
	let normalized = url.to_string();
	Ok(if url.path() == "/" && url.query().is_none() {
		normalized.trim_end_matches('/').to_string()
	} else {
		normalized
	})
}

pub(crate) fn model_list_url(
	api_base_url: &str,
) -> Result<Url, ProviderEndpointError> {
	let mut url = normalized_provider_api_base_url(api_base_url)?;
	let api_path = url.path().trim_end_matches('/');
	let model_path = if api_path.is_empty() {
		"/v1/models".to_string()
	} else {
		format!("{api_path}/models")
	};
	url.set_path(&model_path);
	url.set_fragment(None);
	Ok(url)
}

/// Checks whether a stored key belongs to the requested provider endpoint.
pub fn provider_credential_scope_matches(
	provider: &InferenceProvider,
	format: InferenceProviderFormat,
	api_base_url: &str,
) -> bool {
	if provider.format != format {
		return false;
	}
	if provider.api_base_url.trim() == api_base_url.trim() {
		return true;
	}
	let Ok(saved_url) =
		normalized_provider_api_base_url(&provider.api_base_url)
	else {
		return false;
	};
	let Ok(requested_url) = normalized_provider_api_base_url(api_base_url)
	else {
		return false;
	};
	saved_url == requested_url
}
