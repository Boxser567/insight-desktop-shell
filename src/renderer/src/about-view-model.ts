export interface AboutViewModel {
  productName: string
  poweredBy: string
  versionText: string
  releaseText: string
  copyright: string
}

export function createAboutViewModel(input: {
  version: string
  releaseDate: string
}): AboutViewModel {
  if (!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/u.test(input.version)) {
    throw new Error('Invalid desktop version metadata.')
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(input.releaseDate)
  const date = new Date(`${input.releaseDate}T00:00:00Z`)
  if (
    !match ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input.releaseDate
  ) {
    throw new Error('Invalid desktop release date metadata.')
  }
  const [, year, month, day] = match
  return {
    productName: '因赛AI',
    poweredBy: 'Powered by InClaw & OWL',
    versionText: `版本 ${input.version}`,
    releaseText: `发布于 ${Number(year)}年${Number(month)}月${Number(day)}日`,
    copyright: '© 因赛AI'
  }
}
