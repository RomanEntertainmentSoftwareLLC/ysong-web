import Reveal from "./Reveal";
import { useTheme } from "../ThemeContext";
import { useNavigate } from "react-router-dom";
import ysongTitleWithLogo from "/ysong-logo-with-title.png";
import ysongTitleWithLogoDark from "/ysong-logo-with-title-darkmode.png";

export default function Home() {
    const { dark } = useTheme();
    const navigate = useNavigate();

    return (
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            {/* LOGO */}
            <section className="pt-6 sm:pt-10">
                <Reveal className="text-center">
                    <img
                        src={dark ? ysongTitleWithLogoDark : ysongTitleWithLogo}
                        alt="YSong"
                        className="mx-auto h-16 sm:h-20 md:h-28 lg:h-32 w-auto"
                        loading="eager"
                    />
                    <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
                        Your ultimate AI music co-pilot
                    </h1>
                    <p className="mt-3 text-sm sm:text-base">
                        Create, transform, generate, and learn music all on one
                        platform powered by
                        <span className="whitespace-nowrap">
                            {" "}
                            advanced artificial intelligence
                        </span>{" "}
                        that understands music the way you do!
                    </p>
                </Reveal>

                {/* Image / banner placeholder */}
                <Reveal className="mt-6">
                    <div
                        className="h-56 sm:h-72 md:h-96 w-full rounded-2xl
							bg-gradient-to-r from-neutral-400 to-neutral-600
							dark:from-neutral-800 dark:to-neutral-600
							grid place-items-center text-neutral-600 dark:text-neutral-300"
                    >
                        {/* TODO: Replace with your hero image when ready */}
                        <span className="text-sm sm:text-base">
                            Hero image placeholder
                        </span>
                    </div>
                </Reveal>
            </section>

            {/* WHAT IS YSONG */}
            <section className="mt-12 sm:mt-16">
                <Reveal as="h2" className="text-2xl sm:text-3xl font-bold">
                    What is YSong?
                </Reveal>
                <Reveal as="p" className="mt-3">
                    <strong>YSong</strong> is an end-to-end AI music studio,
                    co-pilot, and instructor. Create, transform, generate, and
                    analyze music from first idea to finished release while
                    working with the tools you already use. With a vast library
                    spanning from Bach to Beyoncé, YSong surfaces artist
                    histories and discographies and guides you with interactive
                    lessons to level up your skills on any instrument. Available
                    on desktop, mobile, and the web.
                </Reveal>
            </section>

            {/* FEATURE GRID */}
            <section className="mt-10 sm:mt-12">
                <Reveal as="h3" className="text-xl sm:text-2xl font-semibold">
                    What you can do with YSong
                </Reveal>

                <div className="mt-6 grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
                    <Reveal className="rounded-xl border p-4">
                        <h4 className="font-semibold">Generate</h4>
                        <ul className="mt-2 list-disc pl-5 text-sm leading-6">
                            <li>
                                Generate full songs from prompts or references
                            </li>
                            <li>
                                Write lyrics and melodies with the LLM co-writer
                            </li>
                            <li>Create album covers and artwork</li>
                        </ul>
                    </Reveal>

                    <Reveal className="rounded-xl border p-4">
                        <h4 className="font-semibold">Transform</h4>
                        <ul className="mt-2 list-disc pl-5 text-sm leading-6">
                            <li>Swap genres, moods, and arrangements</li>
                            <li>
                                Swap singers or use <em>your</em> voice (or a
                                celebrity timbre)
                            </li>
                            <li>Time-stretch, pitch-shift, remix, re-master</li>
                        </ul>
                    </Reveal>

                    <Reveal className="rounded-xl border p-4">
                        <h4 className="font-semibold">Separate</h4>
                        <ul className="mt-2 list-disc pl-5 text-sm leading-6">
                            <li>
                                Isolate vocals (a cappella) and instrumentals
                            </li>
                            <li>
                                Split individual instruments (drums, bass,
                                piano, etc.)
                            </li>
                            <li>Export clean stems for mixing</li>
                        </ul>
                    </Reveal>

                    <Reveal className="rounded-xl border p-4">
                        <h4 className="font-semibold">Studio &amp; DAW</h4>
                        <ul className="mt-2 list-disc pl-5 text-sm leading-6">
                            <li>Built-in DAW: record, edit, comp, and mix</li>
                            <li>
                                Use any MIDI/USB instrument plugged into your
                                computer
                            </li>
                            <li>
                                VST3 plug-in for Cubase, Pro Tools, Logic,
                                Reason, &amp; more
                            </li>
                        </ul>
                    </Reveal>

                    <Reveal className="rounded-xl border p-4">
                        <h4 className="font-semibold">Analyze &amp; Learn</h4>
                        <ul className="mt-2 list-disc pl-5 text-sm leading-6">
                            <li>
                                Artist/album/song facts: label, year, BPM,
                                key/scale
                            </li>
                            <li>Generate sheet music by instrument</li>
                            <li>Create guitar tabs and practice exercises</li>
                            <li>
                                Interactive lessons from beginner to advanced
                            </li>
                        </ul>
                    </Reveal>

                    <Reveal className="rounded-xl border p-4">
                        <h4 className="font-semibold">…and more</h4>
                        <ul className="mt-2 list-disc pl-5 text-sm leading-6">
                            <li>Smart search and music knowledge Q&amp;A</li>
                            <li>Project sharing and collaboration</li>
                            <li>
                                Writers block mode to suggest the next set of
                                notes or lyrics
                            </li>
                            <li>Export to WAV, MP3, and MIDI</li>
                        </ul>
                    </Reveal>
                </div>
            </section>

            {/* PLATFORMS */}
            <section className="mt-10 sm:mt-12">
                <Reveal as="h3" className="text-xl sm:text-2xl font-semibold">
                    Platforms
                </Reveal>
                <Reveal className="mt-4 flex flex-wrap gap-2">
                    {[
                        "Windows",
                        "macOS",
                        "Linux",
                        "iOS",
                        "Android",
                        "Web",
                        "VST3 plug-in",
                    ].map((p) => (
                        <span
                            key={p}
                            className="rounded-full border border-neutral-300/70 dark:border-neutral-700/70
									px-3 py-1 text-xs sm:text-sm"
                        >
                            {p}
                        </span>
                    ))}
                </Reveal>
            </section>

            {/* CTA (optional placeholder for now) */}
            <section className="mt-10 sm:mt-12 mb-16 text-center">
                <Reveal>
                    <button
                        type="button"
                        onClick={() => navigate("/signup")}
                        className="px-3 py-2 text-sm font-medium rounded-lg border"
                    >
                        Get started
                    </button>
                </Reveal>
            </section>
        </div>
    );
}
