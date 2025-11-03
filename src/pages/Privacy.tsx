export default function Privacy() {
    return (
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl sm:text-4xl font-bold mb-6">
                Privacy Notice
            </h1>

            <p className="opacity-80 mb-8">
                This Privacy Notice explains how Roman Entertainment Software
                LLC (“YSong,” “we,” “us,” or “our”) collects, uses, and shares
                personal information when you use our websites, apps, plug-ins,
                and related services (collectively, the “Services”). By using
                the Services, you agree to this Notice.
            </p>

            <section className="mb-8">
                <h2 className="text-2xl font-semibold mb-3">1) Scope</h2>
                <p className="opacity-80">
                    This Notice applies to information we collect about users of
                    YSong’s website, web app, and desktop plug-ins (e.g.,
                    VST/AU/AAX), as well as to communications you send us. It
                    does not cover third-party sites or services that we do not
                    control.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="text-2xl font-semibold mb-3">
                    2) Information We Collect
                </h2>
                <ul className="list-disc pl-6 space-y-2 opacity-80">
                    <li>
                        <span className="font-medium">
                            Account & Contact Data:
                        </span>{" "}
                        name or handle, email address, authentication tokens,
                        and settings you configure.
                    </li>
                    <li>
                        <span className="font-medium">
                            Content You Provide:
                        </span>{" "}
                        audio files (e.g., WAV/MP3), stems, images, lyrics/text,
                        prompts, chat messages, project metadata, and other
                        assets you upload or create.
                    </li>
                    <li>
                        <span className="font-medium">
                            Usage & Device Data:
                        </span>{" "}
                        log data (timestamps, feature usage, error logs),
                        approximate location from IP, browser/OS information,
                        and device identifiers. We use this for security,
                        debugging, and improving performance.
                    </li>
                    <li>
                        <span className="font-medium">
                            Cookies & Similar Tech:
                        </span>{" "}
                        cookies and local storage for session management,
                        preferences, and analytics.
                    </li>
                    <li>
                        <span className="font-medium">Payment Data:</span>{" "}
                        processed by our payment provider (not stored by us)
                        if/when paid plans are enabled.
                    </li>
                </ul>
            </section>

            <section className="mb-8">
                <h2 className="text-2xl font-semibold mb-3">
                    3) How We Use Information
                </h2>
                <ul className="list-disc pl-6 space-y-2 opacity-80">
                    <li>Operate, maintain, and secure the Services.</li>
                    <li>
                        Provide features such as chat, generation, project
                        storage, and sync.
                    </li>
                    <li>
                        Process your content to generate outputs you request.
                    </li>
                    <li>
                        Communicate with you about updates, security, and
                        support.
                    </li>
                    <li>
                        Improve and research product performance and usability.
                    </li>
                    <li>
                        Comply with legal obligations and enforce our Terms of
                        Use.
                    </li>
                </ul>
            </section>

            <section className="mb-8">
                <h2 className="text-2xl font-semibold mb-3">
                    4) AI Processing & Logs
                </h2>
                <p className="opacity-80">
                    When you submit prompts, files, or instructions, our systems
                    process that data to produce outputs (e.g., audio, text,
                    images). We may temporarily store request/response logs and
                    derived metadata for debugging, abuse detection, and service
                    improvement. We do not sell your content. You are
                    responsible for ensuring you have rights to materials you
                    upload and for how you use generated outputs.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="text-2xl font-semibold mb-3">
                    5) Sharing & Service Providers
                </h2>
                <p className="opacity-80 mb-3">
                    We share information with vendors who help us operate the
                    Services, under contracts that limit their use of your data:
                </p>
                <ul className="list-disc pl-6 space-y-2 opacity-80">
                    <li>
                        <span className="font-medium">Hosting & Compute:</span>{" "}
                        Google Cloud Platform (VMs, storage), Vercel (web
                        hosting/deployment).
                    </li>
                    <li>
                        <span className="font-medium">Database:</span> Neon
                        (PostgreSQL).
                    </li>
                    <li>
                        <span className="font-medium">Email Delivery:</span>{" "}
                        Resend (transactional email).
                    </li>
                    <li>
                        <span className="font-medium">
                            Analytics/Monitoring:
                        </span>{" "}
                        tools we may add for performance and error reporting.
                    </li>
                </ul>
                <p className="opacity-80 mt-3">
                    We may disclose information if required by law, to protect
                    rights and safety, or in connection with a business
                    transaction (e.g., merger or acquisition). We do not sell
                    personal information.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="text-2xl font-semibold mb-3">
                    6) Cookies & Preferences
                </h2>
                <p className="opacity-80">
                    We use essential cookies for authentication and security,
                    and performance cookies to understand how the Services are
                    used. You can control cookies via your browser settings;
                    disabling certain cookies may impact features (e.g., staying
                    signed in).
                </p>
            </section>

            <section className="mb-8">
                <h2 className="text-2xl font-semibold mb-3">
                    7) Data Retention
                </h2>
                <p className="opacity-80">
                    We retain personal information for as long as needed to
                    provide the Services and for legitimate business purposes
                    (e.g., security, backups, legal compliance). You may delete
                    projects or request account deletion; some logs or backups
                    may persist for a limited period after deletion for security
                    and integrity purposes.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="text-2xl font-semibold mb-3">8) Security</h2>
                <p className="opacity-80">
                    We implement reasonable administrative, technical, and
                    physical safeguards appropriate to the nature of the data we
                    process. No method of transmission or storage is 100%
                    secure, and we cannot guarantee absolute security. Please
                    use strong, unique passwords and keep your devices updated.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="text-2xl font-semibold mb-3">
                    9) International Transfers
                </h2>
                <p className="opacity-80">
                    We may process and store information in the United States or
                    other countries where we or our providers operate. By using
                    the Services, you acknowledge such transfers, which we
                    safeguard as required by applicable law.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="text-2xl font-semibold mb-3">
                    10) Your Privacy Rights
                </h2>
                <p className="opacity-80 mb-3">
                    Depending on your location, you may have rights to access,
                    correct, delete, or export your personal information, and to
                    object to or restrict certain processing. You may also opt
                    out of non-essential marketing communications at any time.
                </p>
                <ul className="list-disc pl-6 space-y-2 opacity-80">
                    <li>
                        <span className="font-medium">EU/UK users:</span> You
                        may have GDPR rights including access, rectification,
                        erasure, portability, and objection; you may also lodge
                        a complaint with a supervisory authority.
                    </li>
                    <li>
                        <span className="font-medium">California users:</span>{" "}
                        You may have CPRA rights including access, deletion, and
                        the right to know. We do not sell or share personal
                        information for cross-context behavioral advertising.
                    </li>
                </ul>
                <p className="opacity-80 mt-3">
                    To exercise rights, contact us at{" "}
                    <a
                        href="mailto:legal@ysong.ai"
                        className="text-blue-400 hover:underline"
                    >
                        legal@ysong.ai
                    </a>
                    . We may need to verify your identity before fulfilling
                    requests.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="text-2xl font-semibold mb-3">
                    11) Children’s Privacy
                </h2>
                <p className="opacity-80">
                    The Services are not directed to children under 13 (or
                    older, where required by local law). We do not knowingly
                    collect personal information from children. If you believe a
                    child has provided us information, contact us and we will
                    take appropriate action.
                </p>
            </section>

            <section className="mb-8">
                <h2 className="text-2xl font-semibold mb-3">
                    12) Changes to This Notice
                </h2>
                <p className="opacity-80">
                    We may update this Privacy Notice from time to time. If we
                    make material changes, we will update the “Last updated”
                    date below and, if appropriate, notify you through the
                    Services or by email.
                </p>
            </section>

            <section>
                <h2 className="text-2xl font-semibold mb-3">13) Contact Us</h2>
                <p className="opacity-80">
                    Questions or requests about this Notice can be sent to{" "}
                    <a
                        href="mailto:legal@ysong.ai"
                        className="text-blue-400 hover:underline"
                    >
                        legal@ysong.ai
                    </a>
                    .
                </p>
                <p className="text-sm opacity-60 mt-6">
                    Last updated: {new Date().toLocaleDateString()}
                </p>
            </section>
        </div>
    );
}
