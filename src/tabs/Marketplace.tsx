
export default function MarketplacePane() {
  return <div className="h-full overflow-y-auto bg-neutral-950 text-neutral-100">
    <div className="mx-auto max-w-6xl p-5 md:p-7 pb-24">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs uppercase tracking-[.22em] text-emerald-300">YSong creators</div>
          <h1 className="mt-1 text-3xl font-semibold">Marketplace</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-400">A future storefront for real creator-published effects, instruments, samples, MIDI, presets, artwork and themes.</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 text-xs text-neutral-400">Commerce backend not connected yet</span>
      </div>

      <section className="mt-8 overflow-hidden rounded-3xl border border-emerald-400/15 bg-gradient-to-br from-emerald-400/10 via-cyan-400/[.04] to-violet-400/[.06] p-7 md:p-10">
        <div className="max-w-2xl">
          <div className="text-sm font-medium text-emerald-200">No fake listings.</div>
          <h2 className="mt-2 text-2xl font-semibold md:text-3xl">The Marketplace will stay empty until real creators can publish real products.</h2>
          <p className="mt-3 text-sm leading-relaxed text-neutral-400">The previous demo packs were useful during UI prototyping, but they looked like actual products. They have been removed. Checkout, creator onboarding, uploads, licensing, delivery, ownership and refunds will be implemented before public listings appear here.</p>
        </div>
      </section>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[{title:"Creator publishing",body:"Upload a real product, set licensing and pricing, add previews and publish a listing."},{title:"Safe delivery",body:"Purchased/free assets appear in My Library with ownership records and verified downloads."},{title:"YSong-native install",body:"Compatible instruments, presets and themes can eventually install directly into the correct YSong location."}].map((item) => <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[.025] p-5"><div className="text-sm font-semibold">{item.title}</div><p className="mt-2 text-xs leading-relaxed text-neutral-500">{item.body}</p></div>)}
      </div>
    </div>
  </div>;
}
