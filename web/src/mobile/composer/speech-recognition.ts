export interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}

export interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  start(): void
  stop(): void
}

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike
}

export interface SpeechRecognitionWindow {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

export function getSpeechRecognitionConstructor(source: SpeechRecognitionWindow): SpeechRecognitionConstructor | undefined {
  return source.SpeechRecognition ?? source.webkitSpeechRecognition
}
