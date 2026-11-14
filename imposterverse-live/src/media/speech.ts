// Speech-to-text for spoken clues.
//
// This is deliberately separate from voice chat: what the other players HEAR is
// the speaker's real voice over WebRTC. Transcription only produces the text of
// the clue, which its owner reviews, can correct, and then confirms.
//
// It uses the browser's built-in speech recognition (Chrome, Edge, Safari).
// Note for the privacy policy: in most browsers that service sends the audio
// of the utterance to the browser vendor to be recognised. Where it is missing
// (e.g. Firefox) or fails, the game falls back to typing the clue.

type Recogniser = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

const Ctor: (new () => Recogniser) | undefined =
  typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined;

export const speechSupported = !!Ctor;

export interface Listening {
  /** Stop listening and resolve with the best transcript (empty if nothing was understood). */
  stop(): Promise<string>;
  /** Throw the utterance away. */
  cancel(): void;
}

/** Tidy a raw transcript into a clue: no trailing punctuation, sentence case, bounded length. */
export function tidyClue(raw: string, max: number): string {
  const text = raw.replace(/\s+/g, ' ').replace(/[.?!,;:]+$/g, '').trim();
  if (!text) return '';
  return (text[0].toUpperCase() + text.slice(1)).slice(0, max);
}

/**
 * Starts listening. `onInterim` is called with the words heard so far, so the
 * speaker sees their clue forming while they hold the button.
 * Returns null if speech recognition is not available in this browser.
 */
export function listen(onInterim: (text: string) => void, onError?: (reason: string) => void): Listening | null {
  if (!Ctor) return null;
  let rec: Recogniser;
  try {
    rec = new Ctor();
  } catch {
    return null;
  }
  rec.lang = navigator.language || 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = '';
  let interim = '';
  let ended = false;
  let waiting: ((text: string) => void) | null = null;
  const best = () => (finalText + ' ' + interim).trim();

  rec.onresult = (e: any) => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += ' ' + r[0].transcript;
      else interim += r[0].transcript;
    }
    onInterim(best());
  };
  rec.onerror = (e: any) => {
    // "no-speech" and "aborted" are normal; anything else means the service is unavailable.
    if (e?.error && e.error !== 'no-speech' && e.error !== 'aborted') onError?.(String(e.error));
  };
  rec.onend = () => {
    ended = true;
    waiting?.(best());
    waiting = null;
  };

  try {
    rec.start();
  } catch {
    return null;
  }

  return {
    stop() {
      return new Promise<string>((resolve) => {
        if (ended) return resolve(best());
        waiting = resolve;
        try {
          rec.stop();
        } catch {
          resolve(best());
        }
        // Never leave the player stuck on "processing".
        setTimeout(() => {
          if (waiting) {
            waiting = null;
            resolve(best());
          }
        }, 2500);
      });
    },
    cancel() {
      waiting = null;
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    },
  };
}
