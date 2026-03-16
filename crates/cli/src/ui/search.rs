use anyhow::Result;
use crossterm::{
	cursor,
	event::{self, Event, KeyCode, KeyEventKind, KeyModifiers},
	execute, queue,
	terminal::{self, Clear, ClearType},
};
use std::io::{stdout, Write};
use std::sync::Arc;
use tokio::runtime::Runtime;

/// A generic trait for a backend providing real-time search results to the interactive component.
pub trait SearchProvider: Send + Sync {
	type Item: Clone + Send + 'static;

	/// Called asynchronously (in a blocking task pool) to fetch fuzzy matches based on user input.
	fn search(&self, query: &str) -> Vec<Self::Item>;

	/// Called synchronously to format an item for display.
	/// The `is_selected` boolean helps the implementer decide whether to add bolding, coloring, or indicator arrows prefix.
	fn format_item(&self, item: &Self::Item, is_selected: bool) -> String;
}

/// A high-performance, asynchronous interactive search widget.
/// Designed as a lightweight inline prompt replacing heavier generic TUIs.
pub struct RealtimeSearch<P> {
	prompt: String,
	provider: Arc<P>,
	rt: Arc<Runtime>,
	debounce_ms: u64,
	min_query_len: usize,
}

impl<P: SearchProvider + 'static> RealtimeSearch<P> {
	pub fn new(
		prompt: impl Into<String>,
		provider: P,
		rt: Arc<Runtime>,
	) -> Self {
		Self {
			prompt: prompt.into(),
			provider: Arc::new(provider),
			rt,
			debounce_ms: 100,
			min_query_len: 3,
		}
	}

	pub fn prompt(self) -> Result<Option<P::Item>> {
		let (query_tx, mut query_rx) =
			tokio::sync::mpsc::unbounded_channel::<String>();
		let (res_tx, res_rx) = std::sync::mpsc::channel::<Vec<P::Item>>();

		let provider = Arc::clone(&self.provider);
		let debounce_ms = self.debounce_ms;
		let min_query_len = self.min_query_len;

		// Spawn a background worker ensuring the UI string typing never stutters,
		// no matter how slow the search() function or network is.
		self.rt.spawn(async move {
			let mut last_fetch = String::new();
			while let Some(query) = query_rx.recv().await {
				tokio::time::sleep(std::time::Duration::from_millis(
					debounce_ms,
				))
				.await;

				let mut latest = query;
				while let Ok(q) = query_rx.try_recv() {
					latest = q;
				}

				if latest == last_fetch {
					continue;
				}
				last_fetch = latest.clone();

				if latest.trim().len() < min_query_len {
					let _ = res_tx.send(vec![]);
					continue;
				}

				let provider_clone = provider.clone();
				let latest_clone = latest.clone();

				// Offload formatting and heavy search network delays without blocking the tokio scheduler itself
				let res = tokio::task::spawn_blocking(move || {
					provider_clone.search(&latest_clone)
				})
				.await
				.unwrap_or_default();

				let _ = res_tx.send(res);
			}
		});

		// RAII guard ensuring the terminal always resets to healthy standard states
		// even if the user ctrl+C triggers a panic or abort.
		struct CleanExit;
		impl Drop for CleanExit {
			fn drop(&mut self) {
				let _ = terminal::disable_raw_mode();
				let _ = execute!(std::io::stdout(), cursor::Show);
			}
		}
		let _cleaner = CleanExit;

		terminal::enable_raw_mode()?;
		let mut stdout_handle = stdout();
		let _ = execute!(stdout_handle, cursor::Hide);

		let mut query = String::new();
		let mut results: Vec<P::Item> = Vec::new();
		let mut selected_idx = 0;
		let mut fetching = false;

		// The visible display prompt format: "? Prompt text: "
		let prompt_len = 4 + self.prompt.len() as u16;

		loop {
			// Re-render frame
			queue!(
				stdout_handle,
				cursor::MoveToColumn(0),
				Clear(ClearType::FromCursorDown)
			)?;

			write!(
				stdout_handle,
				"\r\x1b[32m?\x1b[0m \x1b[1m{name}:\x1b[0m {query}",
				name = self.prompt,
				query = query
			)?;

			if fetching {
				// Indicator to assure user the search is running in background
				write!(stdout_handle, " \x1b[90m...\x1b[0m")?;
			}

			let display_count = std::cmp::min(10, results.len());
			let mut lines_printed: u16 = 0;

			if display_count > 0 {
				for (i, item) in results.iter().enumerate().take(display_count)
				{
					write!(stdout_handle, "\n\r")?;
					let formatted =
						self.provider.format_item(item, i == selected_idx);
					write!(stdout_handle, "{}", formatted)?;
					lines_printed += 1;
				}
			} else if query.len() < self.min_query_len {
				write!(
					stdout_handle,
					"\n\r  \x1b[90mType {} or more characters to search\x1b[0m",
					self.min_query_len
				)?;
				lines_printed += 1;
			} else if !fetching {
				write!(
					stdout_handle,
					"\n\r  \x1b[90mNo results found.\x1b[0m"
				)?;
				lines_printed += 1;
			}

			// Move cursor back upwards to rest precisely at the end of the input query line
			if lines_printed > 0 {
				queue!(stdout_handle, cursor::MoveUp(lines_printed))?;
			}

			queue!(
				stdout_handle,
				cursor::MoveToColumn(prompt_len + query.len() as u16)
			)?;
			stdout_handle.flush()?;

			// Polled event gathering
			while event::poll(std::time::Duration::from_millis(50))? {
				if let Event::Key(key_event) = event::read()? {
					if key_event.kind == KeyEventKind::Release {
						continue;
					}

					if key_event.code == KeyCode::Char('c')
						&& key_event.modifiers.contains(KeyModifiers::CONTROL)
					{
						queue!(
							stdout_handle,
							cursor::MoveDown(lines_printed),
							Clear(ClearType::FromCursorDown)
						)?;
						return Ok(None);
					}

					match key_event.code {
						KeyCode::Esc => {
							queue!(
								stdout_handle,
								cursor::MoveDown(lines_printed),
								Clear(ClearType::FromCursorDown)
							)?;
							return Ok(None);
						}
						KeyCode::Enter => {
							if !results.is_empty()
								&& selected_idx < results.len()
							{
								queue!(
									stdout_handle,
									cursor::MoveDown(lines_printed),
									Clear(ClearType::FromCursorDown)
								)?;
								return Ok(Some(results[selected_idx].clone()));
							}
						}
						KeyCode::Up => {
							selected_idx = selected_idx.saturating_sub(1);
						}
						KeyCode::Down => {
							if selected_idx + 1 < results.len() {
								selected_idx += 1;
							}
						}
						KeyCode::Backspace => {
							if !query.is_empty() {
								query.pop();
								fetching = true;
								let _ = query_tx.send(query.clone());
							}
						}
						KeyCode::Char(c) => {
							query.push(c);
							fetching = true;
							let _ = query_tx.send(query.clone());
						}
						_ => {}
					}
				}
			}

			// Sync background results into hot loop rendering
			while let Ok(r) = res_rx.try_recv() {
				results = r;
				// Keep the selection if we can, otherwise reset to 0
				if selected_idx >= results.len() {
					selected_idx = 0;
				}
				fetching = false;
			}
		}
	}
}
