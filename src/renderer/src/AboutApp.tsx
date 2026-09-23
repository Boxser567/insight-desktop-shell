import appIconUrl from '../../../build/app-icon.png'
import type { AboutViewModel } from './about-view-model'

export function AboutApp({ model }: { model: AboutViewModel }): React.JSX.Element {
  return (
    <main className="about" aria-labelledby="about-product-name">
      <img className="about-icon" src={appIconUrl} alt="" />
      <h1 id="about-product-name">{model.productName}</h1>
      <section className="about-build" aria-label="客户端版本">
        <p>{model.poweredBy}</p>
        <p>{model.versionText}</p>
      </section>
      <p className="about-release">{model.releaseText}</p>
      <p className="about-copyright">{model.copyright}</p>
    </main>
  )
}
