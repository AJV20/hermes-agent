import { useEffect, useRef, useState } from 'react'

import type { MobilePendingAction } from '../mobile-action-state'

type ClarifyResponse = { answer: string; kind: 'clarify'; requestId: string }
type ApprovalResponse = { choice: 'always' | 'deny' | 'once' | 'session'; kind: 'approval'; requestId: string; sessionId: string }

export function ChatActionCard({
  action,
  onRespond
}: {
  action: MobilePendingAction
  onRespond: (response: ClarifyResponse | ApprovalResponse) => Promise<void>
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [freeform, setFreeform] = useState('')
  const [confirmAlways, setConfirmAlways] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const latestActionRef = useRef(action)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    latestActionRef.current = action
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new server action must reset all response controls atomically
    setSelected([])
    setFreeform('')
    setConfirmAlways(false)
    submittingRef.current = false
    setSubmitting(false)
    setError(null)
  }, [action])

  if (action.kind === 'sensitive') {
    return <aside className="mobile-action-card" role="status">Complete this request on trusted desktop.</aside>
  }

  const respond = async (response: ClarifyResponse | ApprovalResponse) => {
    if (submittingRef.current) return
    const submittedAction = action
    submittingRef.current = true
    setSubmitting(true)
    setError(null)
    try {
      await onRespond(response)
    } catch (reason) {
      if (latestActionRef.current !== submittedAction) return
      submittingRef.current = false
      setError(reason instanceof Error ? reason.message : 'Could not send your response. Try again.')
      setSubmitting(false)
    }
  }

  if (action.kind === 'clarify') {
    const selectionRequired = action.choices.length > 0
    const answer = action.multiSelect ? selected.join(', ') : (selected[0] ?? freeform.trim())
    const canContinue = !selectionRequired ? Boolean(answer) : Boolean(selected.length)
    if (action.status === 'expired') {
      return (
        <aside className="mobile-action-card is-expired" role="status">
          <strong>This question expired.</strong>
          <p>{action.question}</p>
          {!!action.choices.length && <p className="mobile-action-choices">{action.choices.join(' · ')}</p>}
          <p>Reply in the composer if you still want to answer; it will be sent as a normal follow-up.</p>
        </aside>
      )
    }
    return (
      <aside aria-label="Clarification needed" className="mobile-action-card" role="group">
        <strong>Clarification needed</strong>
        <p>{action.question}</p>
        {action.choices.length > 0 ? (
          <fieldset disabled={submitting}>
            <legend className="sr-only">Choose an answer</legend>
            {action.choices.map(choice => (
              <label className="mobile-action-choice" key={choice}>
                <input
                  checked={selected.includes(choice)}
                  name={`clarify-${action.requestId}`}
                  onChange={() => setSelected(current => action.multiSelect
                    ? current.includes(choice) ? current.filter(item => item !== choice) : [...current, choice]
                    : [choice])}
                  type={action.multiSelect ? 'checkbox' : 'radio'}
                  value={choice}
                />
                <span>{choice}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <textarea aria-label="Clarification answer" disabled={submitting} onChange={event => setFreeform(event.target.value)} placeholder="Type your answer" rows={2} value={freeform} />
        )}
        {error && <p className="mobile-action-error" role="alert">{error}</p>}
        <button aria-label="Continue clarification" disabled={!canContinue || submitting} onClick={() => void respond({ answer, kind: 'clarify', requestId: action.requestId })} type="button">
          {submitting ? 'Sending…' : 'Continue'}
        </button>
      </aside>
    )
  }

  const labels: Record<ApprovalResponse['choice'], string> = {
    always: 'Always', deny: 'Deny', once: 'Run once', session: 'Allow session'
  }
  const visibleChoices = action.allowPermanent ? action.choices : action.choices.filter(choice => choice !== 'always')
  return (
    <aside aria-label="Command approval needed" className="mobile-action-card" role="group">
      <strong>Command approval needed</strong>
      {action.description && <p>{action.description}</p>}
      <details><summary>Show command</summary><pre>{action.command || 'Command details unavailable'}</pre></details>
      {confirmAlways && action.allowPermanent ? (
        <div className="mobile-action-confirm" role="alert">
          <strong>Always allow this command?</strong>
          <p>This can approve matching commands in future sessions.</p>
          <button aria-label="Confirm always allow" disabled={submitting} onClick={() => void respond({ choice: 'always', kind: 'approval', requestId: action.requestId, sessionId: action.sessionId })} type="button">Confirm always</button>
          <button aria-label="Cancel always allow" disabled={submitting} onClick={() => setConfirmAlways(false)} type="button">Cancel</button>
        </div>
      ) : (
        <div className="mobile-action-buttons">
          {visibleChoices.map(choice => <button aria-label={choice === 'always' ? 'Always allow this command' : labels[choice]} disabled={submitting} key={choice} onClick={() => choice === 'always' ? setConfirmAlways(true) : void respond({ choice, kind: 'approval', requestId: action.requestId, sessionId: action.sessionId })} type="button">{labels[choice]}</button>)}
        </div>
      )}
      {error && <p className="mobile-action-error" role="alert">{error}</p>}
    </aside>
  )
}
