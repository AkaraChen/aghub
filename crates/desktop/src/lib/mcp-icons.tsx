import { CommandLineIcon, WifiIcon } from "@heroicons/react/24/solid";
import type { TransportDto } from "./api-types";

export function getMcpTransportIcon(transport: TransportDto) {
	if (transport.type === "stdio") {
		return <CommandLineIcon className="size-4 shrink-0" />;
	}
	return <WifiIcon className="size-4 shrink-0" />;
}
