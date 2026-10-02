import type { SpeakingOrbWord } from "@/components/interview/speaking-orb-state";

/** Vendored `<speaking-orb>` custom element (public/vendor/speaking-orb). */
export interface SpeakingOrbElement extends HTMLElement {
  state: string;
  say(
    text: string,
    options?: {
      audio?: HTMLMediaElement;
      words?: SpeakingOrbWord[];
      voice?: SpeechSynthesisVoice;
      /** HireOS: follow an element the page already plays. Do not rewind. */
      external?: boolean;
    },
  ): void;
  listen(stream?: MediaStream): Promise<() => void>;
  attachAudio(el: HTMLMediaElement | AudioNode): void;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "speaking-orb": React.DetailedHTMLProps<
        React.HTMLAttributes<SpeakingOrbElement>,
        SpeakingOrbElement
      > & {
        state?: string;
        rest?: string;
        level?: string | number;
        particles?: string | number;
        /** HireOS patch: "off" hides the built-in caption row. */
        captions?: "off" | "on";
      };
    }
  }
}
