import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiPost } from "../lib/authApi";

export default function ForgotUserName() {
    const [email, setEmail] = useState("");
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    async function handleSend() {
        setError(null);
        if (!email) return;

        setSending(true);
        try {
            // backend route you’ll implement on ysong-auth-api
            await apiPost("/auth/username/remind", { email });
            navigate(`/forgot-sent?email=${encodeURIComponent(email)}`);
        } catch (e: any) {
            setError(e?.message || "Could not send email. Try again.");
        } finally {
            setSending(false);
        }
    }

    // …render stays the same…
}
