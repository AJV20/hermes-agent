import { describe, expect, it } from 'vitest'

import { getSpeechRecognitionConstructor } from './speech-recognition'

describe('getSpeechRecognitionConstructor', () => {
  it('returns no recognition constructor when the browser does not support dictation', () => {
    expect(getSpeechRecognitionConstructor({})).toBeUndefined()
  })

  it('uses the webkit-prefixed implementation when that is all the browser provides', () => {
    const WebkitSpeechRecognition = class {}

    expect(getSpeechRecognitionConstructor({ webkitSpeechRecognition: WebkitSpeechRecognition as never })).toBe(WebkitSpeechRecognition)
  })
})
