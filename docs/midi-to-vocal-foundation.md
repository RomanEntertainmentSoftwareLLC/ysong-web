# Singer-aware MIDI to Vocal foundation

Select a MIDI clip in the DAW and expand **MIDI to Vocal**. Choose a saved Singer Studio identity, enter one syllable per note (or `ah`), and prepare a request. Pitch, duration, velocity and expression remain editable in the existing MIDI editor. Overlapping notes and notes outside the clip must be corrected before preparation.

`Clip.vocalSetup` is optional, so old projects remain compatible. Existing DAW autosave, explicit local save, project file export/import and undo snapshots carry the setup with the clip. It contains a stable singer ID plus a detached identity snapshot, lyrics keyed by note ID, and an optional versioned request. Singer library edits/deletion do not rewrite project history; refreshing a singer is explicit. Copy/paste remaps lyrics to new note IDs and clears the copied request.

The pure `prepareVocalRequest` boundary stores editable source MIDI and its existing provenance, a singer snapshot, tempo/signature, clip placement, expression lanes and per-note syllables. Bars use the DAW's one-based project start and zero-based relative note timing. BPM is quarter notes per minute; seconds per bar is `60 / bpm * numerator * 4 / denominator`. Note seconds are clip-relative; request start seconds are project-relative. Leading silence is retained. There is no tempo map in this foundation.

Requests are always `unavailable`: no singing engine, trained voice model, provider, paid API, network call, audio asset, or completion claim is supplied. Singer descriptions describe identity; they are not executable voice models. Normal MIDI playback is an instrumental preview. A future engine must explicitly support singer/model resolution, syllable alignment and the preserved expression semantics before producing audio, and must retain this source request as provenance.

Preparation compares the full current input with the saved request. Changes to notes, lyrics, singer snapshot, expression, tempo, meter, placement or source provenance mark it stale. The old request stays as provenance until explicitly replaced. Unsupported polyphony is rejected rather than flattened. Deleted note lyrics are ignored; new notes require syllables. No portrait assets are created or changed.

Validation: `node --test tests/midiToVocal.test.mjs tests/vocalToMidi.test.mjs`, production build, focused ESLint for new modules, and existing Node regression tests. Contract tests cover non-4/4 timing, silence, JSON persistence, stale inputs, detached singer snapshots, invalid melodies and copy/paste lyric alignment.
