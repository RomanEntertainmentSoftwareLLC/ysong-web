// src/components/PersonaAssetDrawer.tsx
import { useRef, useState } from "react";
import "../styles/asset-drawer.css";

import { YSButton } from "./YSButton";

type Props = {
	// dock-control (so only one drawer can be open)
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	hideHandle?: boolean; // unused in dock mode, but supported
	embedded?: boolean; // render panel only (no fixed shell)
};

export default function PersonaAssetDrawer(props: Props) {
	const { open: controlledOpen, onOpenChange, hideHandle = false, embedded = false } = props;

	const [openUncontrolled, setOpenUncontrolled] = useState(false);
	const isControlled = typeof controlledOpen === "boolean";
	const open = isControlled ? controlledOpen : openUncontrolled;

	const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
		const value = typeof next === "function" ? next(open) : next;
		if (isControlled) onOpenChange?.(value);
		else setOpenUncontrolled(value);
	};

	const handleRef = useRef<HTMLButtonElement | null>(null);

	const panel = (
		<div
			id="persona-asset-drawer-panel"
			className={`asset-drawer-panel ${open ? "asset-drawer-panel-open" : "asset-drawer-panel-closed"}`}
		>
			{/* header */}
			<div className="asset-drawer-header">
				<div className="asset-drawer-title">PERSONAS</div>

				<div className="asset-drawer-actions">
					<YSButton type="button" onClick={() => setOpen(false)} className="asset-drawer-close-btn">
						Close
					</YSButton>
				</div>
			</div>

			{/* content (IMPORTANT: match ProjectAssetDrawer layout) */}
			<div className="asset-drawer-scroll">
				<div className="asset-drawer-inner">
					<div className="text-[12px] opacity-60 p-2">
						No personas yet. This drawer is wired up and ready.
					</div>
				</div>
			</div>
		</div>
	);

	// If used standalone (not your dock), allow optional handle rendering.
	if (!embedded) {
		return (
			<div className="asset-drawer-shell">
				<div className="asset-drawer-container">
					{!hideHandle && (
						<YSButton
							ref={handleRef}
							type="button"
							onClick={() => setOpen((v) => !v)}
							className="asset-drawer-handle"
							aria-expanded={open}
							aria-controls="persona-asset-drawer-panel"
							title="Personas"
						>
							/=====\
						</YSButton>
					)}
					{panel}
				</div>
			</div>
		);
	}

	// Dock mode: panel only
	return panel;
}
