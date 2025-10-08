export default function Footer() {
    return (
        <footer className="mt-10 sm:mt-16 border-t border-neutral-200/70 dark:border-neutral-800/70">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 text-sm flex flex-col sm:flex-row items-center justify-between gap-2">
                <div>
                    &copy; {new Date().getFullYear()} Roman Entertainment
                    Software LLC
                </div>

                <nav className="flex items-center gap-4">
                    <a
                        href="/legal"
                        className="text-neutral-700 dark:text-neutral-300 hover:text-sky-700 dark:hover:text-sky-400 hover:underline"
                    >
                        Legal Information
                    </a>
                    <a
                        href="/privacy"
                        className="text-neutral-700 dark:text-neutral-300 hover:text-sky-700 dark:hover:text-sky-400 hover:underline"
                    >
                        Privacy Notice
                    </a>
                </nav>
            </div>
        </footer>
    );
}
