import React from 'react'
import ReactDOM from 'react-dom/client'
import { AboutApp } from './AboutApp'
import { createAboutViewModel } from './about-view-model'
import './about.css'

const params = new URLSearchParams(window.location.search)
const model = createAboutViewModel({
  version: params.get('version') ?? '',
  releaseDate: params.get('releaseDate') ?? ''
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AboutApp model={model} />
  </React.StrictMode>
)
