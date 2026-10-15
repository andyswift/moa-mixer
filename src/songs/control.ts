import type { Device } from '../domain/devices/device';
import { Synthesizer } from '../domain/devices/synthesizer';
import { SYNTH_PRESETS } from '../domain/devices/synthPresets';
import type { Patch } from '../domain/patch/patch';

/** The pages a song conducts: each is an instrument page (or the mixer) loaded alongside the records page. */
export const PAGE_IDS = ['mixer', 'synth', 'poly', 'drums', 'lynch', 'duo', 'df2', 'pipe'] as const;
export type PageId = (typeof PAGE_IDS)[number];

export type SettingValue = number | string | boolean;

/** What a song sets on one device: patch slot first, then MIDI channel, then individual controls (which win). */
export interface DeviceSettings {
  preset?: number;
  channel?: string;
  controls?: Record<string, SettingValue>;
}

/** Settings for a page, by device id inside that page's patch. */
export type PageSettings = Record<string, DeviceSettings>;

export type ControlMessage =
  | { type: 'start' }
  | { type: 'apply'; settings?: PageSettings; /** mixer page only: which port feeds each input strip (by name) */ inputs?: Record<string, string> };

export type PageState = 'loaded' | 'started';
export interface StatusMessage {
  page: PageId;
  state: PageState;
}

const controlName = (page: PageId) => `moa-control-${page}`;
const STATUS_NAME = 'moa-control-status';

/** The name of the channel a page listens on for the notes of a song (see `MidiBus`). */
export const songChannelName = (page: PageId): string => `moa-song-${page}`;

function open(name: string): BroadcastChannel | undefined {
  return typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(name);
}

/** A page listens for orders from the records page. Returns a function that stops listening. */
export function listenForControl(page: PageId, onMessage: (m: ControlMessage) => void): () => void {
  const channel = open(controlName(page));
  if (!channel) return () => {};
  channel.onmessage = (e: MessageEvent<ControlMessage>) => {
    if (e.data && typeof e.data.type === 'string') onMessage(e.data);
  };
  return () => channel.close();
}

/** The records page gives a page an order. */
export function sendControl(page: PageId, message: ControlMessage): void {
  const channel = open(controlName(page));
  channel?.postMessage(message);
  channel?.close();
}

/** A page tells whoever is watching how far along it is. */
export function announceStatus(page: PageId, state: PageState): void {
  const channel = open(STATUS_NAME);
  channel?.postMessage({ page, state } satisfies StatusMessage);
  channel?.close();
}

export function watchStatus(onStatus: (s: StatusMessage) => void): () => void {
  const channel = open(STATUS_NAME);
  if (!channel) return () => {};
  channel.onmessage = (e: MessageEvent<StatusMessage>) => onStatus(e.data);
  return () => channel.close();
}

const truthy = (v: SettingValue): boolean => (typeof v === 'string' ? v === '1' || v === 'true' || v === 'on' : typeof v === 'number' ? v !== 0 : v);

/**
 * Applies a song's settings to a page's patch. Unknown devices or controls, and values a control refuses, are skipped
 * and reported (a song written for an older panel should still play); everything else is applied.
 */
export function applySettings(patch: Patch, settings: PageSettings): string[] {
  const warnings: string[] = [];
  for (const [deviceId, s] of Object.entries(settings)) {
    const device = patch.devices.get(deviceId);
    if (!device) {
      warnings.push(`no device ${deviceId}`);
      continue;
    }
    if (s.preset !== undefined) {
      const withSlots = device as Device & { loadSlot?: (i: number) => void; slots?: readonly unknown[] };
      const i = s.preset;
      if (device instanceof Synthesizer && Number.isInteger(i) && i >= 0 && i < SYNTH_PRESETS.length) device.loadPreset(SYNTH_PRESETS[i]!); // the mono synth keeps no slots
      else if (typeof withSlots.loadSlot === 'function' && Number.isInteger(i) && i >= 0 && i < (withSlots.slots?.length ?? 0)) withSlots.loadSlot(i);
      else warnings.push(`${deviceId}: cannot load preset ${i}`);
    }
    const transport = (device as { transport?: { channel?: { set(v: string): void } } }).transport;
    if (s.channel !== undefined) {
      try {
        if (!transport?.channel) throw new Error('no channel setting');
        transport.channel.set(s.channel);
      } catch (e) {
        warnings.push(`${deviceId}: channel ${s.channel}: ${(e as Error).message}`);
      }
    }
    for (const [id, value] of Object.entries(s.controls ?? {})) {
      try {
        const control = device.control(id);
        if (control.kind === 'number') {
          const n = typeof value === 'number' ? value : Number(value);
          if (Number.isNaN(n)) throw new Error('not a number');
          control.set(n);
        } else if (control.kind === 'choice') control.set(String(value));
        else control.set(truthy(value));
      } catch (e) {
        warnings.push(`${deviceId}.${id}: ${(e as Error).message}`);
      }
    }
  }
  return warnings;
}

/** Every control of every device in a patch, as settings: for writing a song down from what you hear. */
export function captureSettings(patch: Patch): PageSettings {
  const out: PageSettings = {};
  for (const [id, device] of patch.devices) {
    const controls: Record<string, SettingValue> = {};
    for (const c of device.controls) controls[c.id] = c.value;
    out[id] = { controls };
  }
  return out;
}
