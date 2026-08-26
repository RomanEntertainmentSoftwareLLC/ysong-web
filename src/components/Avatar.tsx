export default function Avatar({ src, name = "", size = 36, className = "" }: { src?: string | null; name?: string; size?: number; className?: string }) {
	const style = { width: size, height: size };
	if (src) return <img src={src} alt={name ? `${name} avatar` : "Avatar"} style={style} className={`shrink-0 rounded-full object-cover border border-white/10 bg-neutral-800 ${className}`} />;
	return (
		<div aria-label={name ? `${name} avatar` : "Default avatar"} title={name || "Default avatar"} style={style} className={`relative shrink-0 overflow-hidden rounded-full border border-white/10 bg-neutral-800 ${className}`}>
			<div className="absolute left-1/2 top-[22%] h-[34%] w-[34%] -translate-x-1/2 rounded-full bg-neutral-500" />
			<div className="absolute left-1/2 bottom-[-8%] h-[52%] w-[72%] -translate-x-1/2 rounded-[50%_50%_30%_30%] bg-neutral-500" />
		</div>
	);
}
