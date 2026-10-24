import { oddHours } from '../songs/library/oddHours';
import { sunEngine } from '../songs/library/sunEngine';
import type { SetSong } from './bandView';

/** The band's set, in the order the set list shows it. */
export function bandSet(): SetSong[] {
  return [
    {
      song: oddHours(),
      style: 'math rock',
      lead: 'D',
      captions: {
        Intro: 'the guitar’s figure alone, then the hats and the dub bass',
        A: '7/8, grouped 2+2+3: the riff over a ringing E, the free bass answering a beat late',
        B: '5/4, grouped 3+3+2+2: fourths into the delay, the free bass climbing, the backbeat moved',
        'A′': 'the first riff back, its echo pushed, the free bass doubling the guitar',
        C: '4/4: crunch, an angular line, the basses in unison, the kit coming apart. The guitarist freaks out',
        D: 'straight rock: power chords, pumping roots, the free bass leading through his drive',
        'B′': 'the 5/4 riff doubled by both basses',
        End: 'the last chord, left to ring',
      },
    },
    {
      song: sunEngine(),
      style: 'psych jam',
      lead: 'Space',
      captions: {
        Intro: 'the guitar swelling into the echo, a floor tom coming up under it',
        Vamp: 'motorik: one chord, the dub bass driving, the free bass’s figure turning against the bar, the theme',
        Jam: 'E to A on the ride: the guitar wanders off, bending notes up into the echo',
        Peak: 'fuzz: the stoner riff on power chords, both basses under it. The guitarist freaks out',
        Space: 'the kit down to the bell, the echo running away, the free bass taking off through his drive',
        'Vamp′': 'the vamp back, the theme an octave up, sixteenths on the hats',
        End: 'the last chord, ringing into the echo',
      },
    },
  ];
}
