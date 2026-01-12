// src/components/YSButton.tsx
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export interface YSButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	children: ReactNode;
	className?: string;
}

export const YSButton = forwardRef<HTMLButtonElement, YSButtonProps>(({ children, className = "", ...rest }, ref) => {
	return (
		<button ref={ref} className={`ys-button ${className}`.trim()} {...rest}>
			{children}
		</button>
	);
});

YSButton.displayName = "YSButton";
