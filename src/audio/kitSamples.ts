import funkUrl from '../../samples/gaute/gaute-135-funk.wav?url';
import heavyUrl from '../../samples/gaute/gaute-135-heavy.wav?url';
import steadyUrl from '../../samples/gaute/gaute-135-steady.wav?url';
import { CUT_RATE, cutCymbal, type CymbalCut } from '../domain/devices/cymbalSamples';

const BREAKS: Record<CymbalCut, string> = { funk: funkUrl, heavy: heavyUrl, steady: steadyUrl };

/** Fetches the three breaks the MOA-KIT's cymbals come from and cuts the hits out of them (`cymbalSamples.ts`). */
export async function loadCymbalCuts(): Promise<Record<CymbalCut, Float32Array>> {
  const decoder = new OfflineAudioContext(1, 1, CUT_RATE);
  const entries = await Promise.all((Object.keys(BREAKS) as CymbalCut[]).map(async (cut) => {
    const buffer = await decoder.decodeAudioData(await (await fetch(BREAKS[cut])).arrayBuffer());
    return [cut, cutCymbal(buffer.getChannelData(0), cut)] as const;
  }));
  return Object.fromEntries(entries) as Record<CymbalCut, Float32Array>;
}
