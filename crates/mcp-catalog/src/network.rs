use std::{
	io,
	net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
	time::Duration,
};

use reqwest::{
	dns::{Addrs, Name, Resolve, Resolving},
	redirect::Policy,
	Client as HttpClient, Url,
};

const OFFICIAL_REGISTRY_HOST: &str = "registry.modelcontextprotocol.io";
const TRANSPARENT_PROXY_IPV4_RANGE: (Ipv4Addr, u32) =
	(Ipv4Addr::new(198, 18, 0, 0), 15);

// IANA special-purpose ranges and transition prefixes that can encode a
// non-public IPv4 destination.
const NON_PUBLIC_IPV4_RANGES: &[(Ipv4Addr, u32)] = &[
	(Ipv4Addr::new(0, 0, 0, 0), 8),
	(Ipv4Addr::new(10, 0, 0, 0), 8),
	(Ipv4Addr::new(100, 64, 0, 0), 10),
	(Ipv4Addr::new(127, 0, 0, 0), 8),
	(Ipv4Addr::new(169, 254, 0, 0), 16),
	(Ipv4Addr::new(172, 16, 0, 0), 12),
	(Ipv4Addr::new(192, 0, 0, 0), 24),
	(Ipv4Addr::new(192, 0, 2, 0), 24),
	(Ipv4Addr::new(192, 88, 99, 0), 24),
	(Ipv4Addr::new(192, 168, 0, 0), 16),
	(Ipv4Addr::new(198, 18, 0, 0), 15),
	(Ipv4Addr::new(198, 51, 100, 0), 24),
	(Ipv4Addr::new(203, 0, 113, 0), 24),
	(Ipv4Addr::new(224, 0, 0, 0), 4),
	(Ipv4Addr::new(240, 0, 0, 0), 4),
];
const NON_PUBLIC_IPV6_RANGES: &[(Ipv6Addr, u32)] = &[
	(Ipv6Addr::UNSPECIFIED, 96),
	(Ipv6Addr::new(0x64, 0xff9b, 0, 0, 0, 0, 0, 0), 96),
	(Ipv6Addr::new(0x64, 0xff9b, 1, 0, 0, 0, 0, 0), 48),
	(Ipv6Addr::new(0x100, 0, 0, 0, 0, 0, 0, 0), 64),
	(Ipv6Addr::new(0x2001, 0, 0, 0, 0, 0, 0, 0), 23),
	(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 0), 32),
	(Ipv6Addr::new(0x2002, 0, 0, 0, 0, 0, 0, 0), 16),
	(Ipv6Addr::new(0x3fff, 0, 0, 0, 0, 0, 0, 0), 20),
	(Ipv6Addr::new(0xfc00, 0, 0, 0, 0, 0, 0, 0), 7),
	(Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 0), 10),
	(Ipv6Addr::new(0xfec0, 0, 0, 0, 0, 0, 0, 0), 10),
	(Ipv6Addr::new(0xff00, 0, 0, 0, 0, 0, 0, 0), 8),
];

#[derive(Debug, thiserror::Error)]
pub(crate) enum RegistryUrlError {
	#[error("scheme must be http or https")]
	UnsupportedScheme,
	#[error("credentials are not allowed")]
	Credentials,
	#[error("host is required")]
	MissingHost,
	#[error("localhost is not allowed")]
	Localhost,
	#[error("private network targets are not allowed")]
	NonPublicAddress,
}

#[derive(Debug)]
struct PublicDnsResolver;

impl Resolve for PublicDnsResolver {
	fn resolve(&self, name: Name) -> Resolving {
		let host = name.as_str().to_string();
		Box::pin(async move {
			let addresses: Vec<SocketAddr> =
				tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
			if addresses.is_empty() {
				return Err(Box::new(io::Error::new(
					io::ErrorKind::NotFound,
					format!("registry host did not resolve: {host}"),
				)) as _);
			}
			if addresses
				.iter()
				.any(|address| !is_safe_resolved_ip(&host, address.ip()))
			{
				return Err(Box::new(io::Error::new(
					io::ErrorKind::PermissionDenied,
					format!(
						"registry host resolved to a private address: {host}"
					),
				)) as _);
			}
			Ok(Box::new(addresses.into_iter()) as Addrs)
		})
	}
}

pub(crate) fn build_http_client(
	timeout: Duration,
) -> Result<HttpClient, reqwest::Error> {
	HttpClient::builder()
		.timeout(timeout)
		.redirect(Policy::none())
		.no_proxy()
		.dns_resolver(PublicDnsResolver)
		.build()
}

pub(crate) fn validate_registry_url(url: &Url) -> Result<(), RegistryUrlError> {
	if !matches!(url.scheme(), "http" | "https") {
		return Err(RegistryUrlError::UnsupportedScheme);
	}
	if !url.username().is_empty() || url.password().is_some() {
		return Err(RegistryUrlError::Credentials);
	}
	let host = url.host().ok_or(RegistryUrlError::MissingHost)?;
	match host {
		url::Host::Domain(domain) => {
			let normalized = domain.trim_end_matches('.');
			if normalized.eq_ignore_ascii_case("localhost")
				|| normalized.to_ascii_lowercase().ends_with(".localhost")
			{
				return Err(RegistryUrlError::Localhost);
			}
		}
		url::Host::Ipv4(address) => ensure_public_ip(IpAddr::V4(address))?,
		url::Host::Ipv6(address) => ensure_public_ip(IpAddr::V6(address))?,
	}
	Ok(())
}

fn ensure_public_ip(address: IpAddr) -> Result<(), RegistryUrlError> {
	if is_public_ip(address) {
		Ok(())
	} else {
		Err(RegistryUrlError::NonPublicAddress)
	}
}

fn is_public_ip(address: IpAddr) -> bool {
	match address {
		IpAddr::V4(address) => is_public_ipv4(address),
		IpAddr::V6(address) => is_public_ipv6(address),
	}
}

fn is_safe_resolved_ip(host: &str, address: IpAddr) -> bool {
	is_public_ip(address)
		|| (is_official_registry_host(host)
			&& is_transparent_proxy_ipv4(address))
}

fn is_official_registry_host(host: &str) -> bool {
	host.trim_end_matches('.')
		.eq_ignore_ascii_case(OFFICIAL_REGISTRY_HOST)
}

// Some macOS transparent proxies map public DNS names into the RFC 2544
// benchmark range. Only the official Registry receives this exception;
// literal and custom-source URLs in the same range remain blocked.
fn is_transparent_proxy_ipv4(address: IpAddr) -> bool {
	let IpAddr::V4(address) = address else {
		return false;
	};
	let (network, prefix) = TRANSPARENT_PROXY_IPV4_RANGE;
	let mask = u32::MAX.checked_shl(32 - prefix).unwrap_or(0);
	u32::from(address) & mask == u32::from(network) & mask
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
	let value = u32::from(address);
	let in_range = |network: Ipv4Addr, prefix: u32| {
		let mask = u32::MAX.checked_shl(32 - prefix).unwrap_or(0);
		value & mask == u32::from(network) & mask
	};
	!NON_PUBLIC_IPV4_RANGES
		.iter()
		.any(|&(network, prefix)| in_range(network, prefix))
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
	if let Some(mapped) = address.to_ipv4_mapped() {
		return is_public_ipv4(mapped);
	}
	let value = u128::from(address);
	let in_range = |network: Ipv6Addr, prefix: u32| {
		let mask = u128::MAX.checked_shl(128 - prefix).unwrap_or(0);
		value & mask == u128::from(network) & mask
	};
	!NON_PUBLIC_IPV6_RANGES
		.iter()
		.any(|&(network, prefix)| in_range(network, prefix))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn official_domain_accepts_transparent_proxy_address() {
		assert!(is_safe_resolved_ip(
			OFFICIAL_REGISTRY_HOST,
			IpAddr::V4(Ipv4Addr::new(198, 18, 12, 78)),
		));
	}

	#[test]
	fn custom_domain_rejects_transparent_proxy_address() {
		assert!(!is_safe_resolved_ip(
			"registry.example.com",
			IpAddr::V4(Ipv4Addr::new(198, 18, 12, 78)),
		));
	}

	#[test]
	fn official_domain_still_rejects_private_address() {
		assert!(!is_safe_resolved_ip(
			OFFICIAL_REGISTRY_HOST,
			IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10)),
		));
	}
}
