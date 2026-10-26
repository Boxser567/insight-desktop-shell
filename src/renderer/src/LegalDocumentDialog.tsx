import { useEffect, useRef, useState } from 'react'

export type LegalDocumentId = 'service' | 'privacy'

const documents = {
  service: { title: '软件许可及服务协议', load: () => import('./legal/ServiceAgreement.html?raw') },
  privacy: { title: '隐私政策', load: () => import('./legal/PrivacyPolicy.html?raw') }
}

/** Only reviewed, bundled HTML is rendered here; never accept server or user HTML. */
export function LegalDocumentDialog(props: { document: LegalDocumentId; onClose: () => void }): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [html, setHtml] = useState('')
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const document = documents[props.document]

  useEffect(() => {
    const dialog = dialogRef.current!
    const opener = window.document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setHtml('')
    setFailed(false)
    void document.load().then((module) => {
      if (!cancelled) setHtml(module.default)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [document, attempt])

  return (
    <dialog className="legal-dialog" ref={dialogRef} aria-labelledby="legal-dialog-title" onCancel={(event) => { event.preventDefault(); props.onClose() }}>
      <header className="legal-dialog-header">
        <h2 id="legal-dialog-title">{document.title}</h2>
        <button type="button" className="legal-dialog-dismiss" aria-label="关闭协议" onClick={props.onClose} autoFocus>×</button>
      </header>
      <div className="legal-dialog-body" tabIndex={0} aria-label={`${document.title}正文`} aria-busy={!html && !failed}>
        {html ? <article className="legal-document" dangerouslySetInnerHTML={{ __html: html }} /> : failed ? (
          <p role="alert">协议加载失败，请重试。<button type="button" onClick={() => setAttempt((value) => value + 1)}>重新加载</button></p>
        ) : <p role="status">正在加载协议…</p>}
      </div>
      <footer className="legal-dialog-footer">
        <button type="button" className="primary-button" onClick={props.onClose}>关闭</button>
      </footer>
    </dialog>
  )
}
