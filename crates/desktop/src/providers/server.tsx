import { Spinner } from "@heroui/react";
import { invoke } from "@tauri-apps/api/core";
import { info } from "@tauri-apps/plugin-log";
import { useEffect, useState } from "react";
import type { ServerProviderProps } from "../contexts/server";
import { ServerContext } from "../contexts/server";

export function ServerProvider({ children }: ServerProviderProps) {
	const [port, setPort] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		invoke<number>("start_server")
			.then((value) => {
				void info(`Desktop API server started on port ${value}`);
				setPort(value);
			})
			.catch((e) => {
				console.error("Failed to start desktop API server:", e);
				setError(String(e));
			});
	}, []);

	if (error) {
		return (
			<div className="flex h-screen items-center justify-center">
				<p className="text-sm text-danger">
					Failed to start server: {error}
				</p>
			</div>
		);
	}

	if (port === null) {
		return (
			<div className="flex h-screen items-center justify-center">
				<Spinner size="lg" />
			</div>
		);
	}

	return (
		<ServerContext
			value={{ port, baseUrl: `http://localhost:${port}/api/v1` }}
		>
			{children}
		</ServerContext>
	);
}
