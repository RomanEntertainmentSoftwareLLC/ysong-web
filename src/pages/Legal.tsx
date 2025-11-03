export default function Legal() {
    return (
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-10">
            <h1 className="text-3xl sm:text-4xl font-bold mb-6">
                Legal Information & Terms of Use
            </h1>

            <p className="opacity-80 mb-10">
                These Terms of Use and related notices govern access to YSong, a
                service operated by Roman Entertainment Software LLC (“we,”
                “us,” or “our”). By using YSong websites, apps, or plug-ins, you
                agree to the following terms. This summary is provided for
                general information and does not replace professional legal
                advice.
            </p>

            <section className="mb-10">
                <h2 className="text-2xl font-semibold mb-3">
                    1. Company Information
                </h2>
                <ul className="list-disc pl-6 space-y-2">
                    <li>Roman Entertainment Software LLC</li>
                    <li>
                        Contact:{" "}
                        <a
                            href="mailto:support@ysong.ai"
                            className="text-blue-400 hover:underline"
                        >
                            support@ysong.ai
                        </a>
                    </li>
                    <li>Registered in the United States</li>
                    <li>Last updated: {new Date().toLocaleDateString()}</li>
                </ul>
            </section>

            <section className="mb-10">
                <h2 className="text-2xl font-semibold mb-3">
                    2. Acceptable Use
                </h2>
                <p className="opacity-80">
                    You agree to use YSong only for lawful purposes and in a
                    manner that does not infringe the rights of others or
                    restrict anyone’s use of the platform. Reverse-engineering,
                    automated scraping, or unauthorized resale of generated
                    content is prohibited. You are responsible for all activity
                    conducted under your account.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="text-2xl font-semibold mb-3">
                    3. Intellectual Property
                </h2>
                <p className="opacity-80">
                    All software, interfaces, and branding of YSong are owned by
                    Roman Entertainment Software LLC. Users retain ownership of
                    their uploaded materials and any music, lyrics, or artwork
                    they create through YSong, subject to any third-party
                    content licenses used in generation. You grant us a limited
                    license to host, process, and display your content solely to
                    operate the service.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="text-2xl font-semibold mb-3">
                    4. Generated Content & Licensing
                </h2>
                <p className="opacity-80">
                    AI-assisted or fully generated audio, images, or text are
                    provided “as is.” We make no guarantees of originality or
                    copyright status. It is your responsibility to ensure that
                    any material you release publicly complies with copyright
                    and trademark law. When YSong incorporates licensed “style
                    packs,” royalties are automatically distributed according to
                    the pack’s terms.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="text-2xl font-semibold mb-3">
                    5. Disclaimers & Limitation of Liability
                </h2>
                <p className="opacity-80">
                    YSong is provided on an “as-is” and “as-available” basis. We
                    disclaim all warranties, express or implied, including
                    merchantability and fitness for a particular purpose. Roman
                    Entertainment Software LLC shall not be liable for any
                    indirect, incidental, or consequential damages arising from
                    use of the platform, data loss, or service interruption.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="text-2xl font-semibold mb-3">
                    6. Privacy & Data
                </h2>
                <p className="opacity-80">
                    We collect only the information necessary to operate YSong,
                    such as account credentials, usage analytics, and files you
                    choose to upload. Data is stored securely on cloud
                    infrastructure and may be processed in the United States.
                    See our{" "}
                    <a
                        href="/privacy"
                        className="text-blue-400 hover:underline"
                    >
                        Privacy Policy
                    </a>{" "}
                    for full details.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="text-2xl font-semibold mb-3">7. Termination</h2>
                <p className="opacity-80">
                    We reserve the right to suspend or terminate accounts that
                    violate these Terms or cause harm to the platform. Upon
                    termination, your license to use YSong ends, but you retain
                    rights to your own exported works.
                </p>
            </section>

            <section className="mb-10">
                <h2 className="text-2xl font-semibold mb-3">
                    8. Changes to These Terms
                </h2>
                <p className="opacity-80">
                    We may update these Terms from time to time. When we make
                    material changes, we will revise the “Last updated” date
                    and, where appropriate, notify registered users by email or
                    in-app message.
                </p>
            </section>

            <section>
                <h2 className="text-2xl font-semibold mb-3">9. Contact</h2>
                <p className="opacity-80">
                    For legal or compliance inquiries, email{" "}
                    <a
                        href="mailto:legal@ysong.ai"
                        className="text-blue-400 hover:underline"
                    >
                        legal@ysong.ai
                    </a>
                    .
                </p>
                <p className="text-sm opacity-60 mt-6 italic">
                    *This page is provided for informational purposes only and
                    does not constitute legal advice. Users should seek
                    independent legal counsel for specific concerns.*
                </p>
            </section>
        </div>
    );
}
