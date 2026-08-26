import claudeLogo from "@lobehub/icons-static-svg/icons/claude.svg?raw";
import geminiLogo from "@lobehub/icons-static-svg/icons/gemini.svg?raw";
import grokLogo from "@lobehub/icons-static-svg/icons/grok.svg?raw";
import kimiLogo from "@lobehub/icons-static-svg/icons/kimi.svg?raw";
import openAiLogo from "@lobehub/icons-static-svg/icons/openai.svg?raw";
import { cn } from "../../lib/utils";

const LOGO_SVGS: Record<string, string> = {
	claude: claudeLogo,
	gemini: geminiLogo,
	grok: grokLogo,
	kimi: kimiLogo,
	openai: openAiLogo,
};

export function UpstreamProviderIcon({
	logo,
	className,
}: {
	logo: string;
	className?: string;
}) {
	const svg = LOGO_SVGS[logo];
	if (!svg) return null;

	return (
		<span
			className={cn(
				"size-4 shrink-0 text-foreground [&>svg]:size-full",
				className,
			)}
			aria-hidden
			// eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
			dangerouslySetInnerHTML={{ __html: svg }}
		/>
	);
}
