import { Link, useSearchParams } from "react-router-dom";

function mask(email: string) {
    const [name, domain] = email.split("@");
    if (!domain) return email;
    const head = name.slice(0, 2);
    return `${head}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
}

export default function ForgotSent() {
    const [params] = useSearchParams();
    const raw = params.get("email") || "";
    const shown = raw ? mask(raw) : "";

    return (
        <div className="mx-auto max-w-md px-4 sm:px-6 lg:px-8 py-10 text-center">
            <h1 className="text-3xl sm:text-4xl font-bold">Check your inbox</h1>
            <p className="mt-4 opacity-80">
                {shown ? (
                    <>
                        We've sent an email to{" "}
                        <span className="font-semibold">{shown}</span>.
                    </>
                ) : (
                    "We've sent an email."
                )}{" "}
                Follow the instructions to recover your username. If you don’t
                see it, check your spam or junk folder.
            </p>

            <div className="mt-8">
                <Link
                    to="/login"
                    className="px-4 py-2 text-sm font-semibold rounded-lg border inline-block"
                >
                    Return to login
                </Link>
            </div>
        </div>
    );
}
