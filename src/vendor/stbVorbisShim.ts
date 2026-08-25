/**
 * YSong compatibility shim for the currently published stb-vorbis package.
 *
 * stb-vorbis@0.0.6 advertises dist/index.js, but that runtime file is missing
 * from the package. SpessaSynth imports the symbol even when YSong is using its
 * normal SF2 soundfont path, which makes Vite's dependency optimizer fail.
 *
 * YSong's bundled GeneralUser-GS bank is SF2, so Vorbis/SF3 decoding is not used
 * in our supported GM path. Keep the import resolvable without upgrading the
 * synth stack. If an SF3/Ogg soundfont is deliberately introduced later, replace
 * this shim with a working decoder rather than silently accepting it here.
 */
export class StbVorbis {
  static readonly ready = Promise.resolve();

  static decode(..._args: unknown[]): never {
    throw new Error(
      "YSong SF3/Ogg soundfont decoding is unavailable because the upstream stb-vorbis runtime package is incomplete. Use the bundled SF2 bank.",
    );
  }
}
