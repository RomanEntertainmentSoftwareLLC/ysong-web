import {
    useEffect,
    useRef,
    useState,
    type ReactNode,
    type ElementType,
} from "react";

type Props = {
    children: ReactNode;
    className?: string;
    as?: ElementType;
};

export default function Reveal({
    children,
    className = "",
    as = "div",
}: Props) {
    // render tag, default <div>
    const Tag = as as any;

    // track element + visibility
    const ref = useRef<HTMLElement | null>(null);
    const [reveal, setReveal] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const io = new IntersectionObserver(
            ([entry]) => setReveal(entry.isIntersecting),
            { threshold: 0.2 }
        );

        io.observe(el);
        return () => io.disconnect();
    }, []);

    return (
        <Tag
            ref={ref as any}
            data-reveal={reveal}
            className={[
                // start hidden, then animate in when visible
                "opacity-0 translate-y-4 transition-all duration-700 ease-out",
                "data-[reveal=true]:opacity-100 data-[reveal=true]:translate-y-0",
                className,
            ].join(" ")}
        >
            {children}
        </Tag>
    );
}
