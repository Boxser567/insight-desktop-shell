import { useEffect, useState } from 'react'
import appIconUrl from '../../../build/app-icon.png'
import type { AboutViewModel } from './about-view-model'

export function AboutApp({ model }: { model: AboutViewModel }): React.JSX.Element {
  const api = window.insightAboutUpdates
  const [candidateOptIn, setCandidateOptIn] = useState<boolean>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    void api.preference().then((preference) => {
      if (active) setCandidateOptIn(preference.candidateOptIn)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [api])

  const changeCandidateOptIn = (value: boolean): void => {
    setPending(true)
    setError(undefined)
    void api.setCandidateOptIn(value).then((preference) => {
      setCandidateOptIn(preference.candidateOptIn)
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => setPending(false))
  }

  const openCandidateCheck = (): void => {
    setError(undefined)
    void api.openCandidateCheck().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <main className="about" aria-labelledby="about-product-name">
      <section className="about-product">
        <img className="about-icon" src={appIconUrl} alt="" />
        <h1 id="about-product-name">{model.productName}</h1>
        <div className="about-build" aria-label="客户端版本">
          <p>{model.poweredBy}</p>
          <p>{model.versionText}</p>
        </div>
        <p className="about-release">{model.releaseText}</p>
      </section>
      <section className="about-updates" aria-label="内测更新">
        <label className="about-update-toggle">
          <span>
            <strong>接收内测更新</strong>
            <small>可能不稳定，且不会自动降级</small>
          </span>
          <input
            type="checkbox"
            checked={candidateOptIn ?? false}
            disabled={candidateOptIn === undefined || pending}
            onChange={(event) => changeCandidateOptIn(event.currentTarget.checked)}
          />
        </label>
        <button
          type="button"
          className="about-candidate-check"
          disabled={!candidateOptIn || pending}
          onClick={openCandidateCheck}
        >
          检查内测更新
        </button>
        {error && <p className="about-update-error" role="alert">{error}</p>}
      </section>
      <p className="about-copyright">{model.copyright}</p>
    </main>
  )
}
