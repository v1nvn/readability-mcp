declare module 'jsdom' {
  export interface JSDOMOptions {
    readonly contentType?: string;
    readonly pretendToBeVisual?: boolean;
    readonly referrer?: string;
    readonly runScripts?: 'dangerously' | 'outside-only';
    readonly url?: string;
  }

  export class JSDOM {
    public readonly window: typeof globalThis & Window;
    public constructor(input?: string, options?: JSDOMOptions);
    public serialize(): string;
  }
}
