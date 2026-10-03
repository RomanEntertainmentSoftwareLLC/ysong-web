import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMiniMaxTrack, uploadGeneratedAudio } from '../src/lib/musicGeneration.ts';
test('persisted server audio keeps the binary contract and avoids a second upload for the same account',async()=>{
  const previousFetch=globalThis.fetch,previousStorage=globalThis.localStorage;
  let token='fixture-token',calls=0;
  globalThis.localStorage={getItem:()=>token};
  globalThis.fetch=async()=>{calls++;return new Response(new Blob(['audio'],{type:'audio/wav'}),{headers:{'X-YSong-Object-Key':'user-uploads/owner/generations/audio.wav'}});};
  try{
    const blob=await generateMiniMaxTrack({instructions:'fixture',lyrics:'[Instrumental]'});
    assert.ok(blob instanceof Blob);assert.equal(await blob.text(),'audio');
    assert.equal((await uploadGeneratedAudio(blob,'Song.wav')).objectKey,'user-uploads/owner/generations/audio.wav');assert.equal(calls,1);
    token='different-account';globalThis.fetch=async()=>{calls++;return Response.json({objectKey:'user-uploads/different/audio.wav'});};
    assert.equal((await uploadGeneratedAudio(blob,'Song.wav')).objectKey,'user-uploads/different/audio.wav');assert.equal(calls,2);
  }finally{globalThis.fetch=previousFetch;globalThis.localStorage=previousStorage;}
});
test('legacy music responses still use the existing authenticated upload',async()=>{
  const previousFetch=globalThis.fetch,previousStorage=globalThis.localStorage;
  let calls=0;globalThis.localStorage={getItem:()=> 'fixture-token'};
  globalThis.fetch=async(_url,options)=>{calls++;if(calls===1)return new Response(new Blob(['legacy'],{type:'audio/wav'}));assert.equal(options.headers.Authorization,'Bearer fixture-token');return Response.json({objectKey:'user-uploads/owner/legacy.wav'});};
  try{const audio=await generateMiniMaxTrack({instructions:'fixture',lyrics:'[Instrumental]'});assert.equal((await uploadGeneratedAudio(audio,'Legacy.wav')).objectKey,'user-uploads/owner/legacy.wav');assert.equal(calls,2);}
  finally{globalThis.fetch=previousFetch;globalThis.localStorage=previousStorage;}
});
