import { useEffect, useState } from 'react'
import type { AuthCommandResult, CaptchaView } from '../../shared/auth-contracts'
import brandMark from '../../../build/brand-mark.svg'
import { canSubmitPassword, canSubmitSms, validatePhone } from './auth-form-model'

type LoginMethod = 'sms' | 'password'

function failureMessage(result: AuthCommandResult): string | undefined {
  return result.ok ? undefined : result.message
}

/** Full-screen SMS and password login surface. */
export function LoginView(props: { busy: boolean; expired: boolean }): React.JSX.Element {
  const [method, setMethod] = useState<LoginMethod>('sms')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [imageCode, setImageCode] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [captcha, setCaptcha] = useState<CaptchaView>()
  const [captchaLoading, setCaptchaLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [message, setMessage] = useState(props.expired ? '登录已失效，请重新登录。' : '')

  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [countdown])

  const loadCaptcha = async (): Promise<void> => {
    setCaptchaLoading(true)
    setMessage('')
    try {
      const result = await window.insightAuth.loadCaptcha()
      if (result.ok) {
        setCaptcha(result.captcha)
        setImageCode('')
      } else {
        setMessage(result.message)
      }
    } finally {
      setCaptchaLoading(false)
    }
  }

  useEffect(() => {
    if (method === 'password' && !captcha) void loadCaptcha()
  }, [method])

  useEffect(() => {
    if (props.expired) setMessage('登录已失效，请重新登录。')
  }, [props.expired])

  const sendCode = async (): Promise<void> => {
    if (!validatePhone(phone) || countdown > 0) return
    setMessage('')
    const result = await window.insightAuth.sendSmsCode(phone)
    if (result.ok) setCountdown(60)
    else setMessage(result.message)
  }

  const submitSms = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!canSubmitSms({ phone, code, agreed }) || props.busy) return
    setMessage('')
    const result = await window.insightAuth.loginSms({ phone, code })
    setMessage(failureMessage(result) ?? '')
  }

  const submitPassword = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!captcha || !canSubmitPassword({ phone, password, imageCode, uuid: captcha.uuid, agreed }) || props.busy) return
    setMessage('')
    const result = await window.insightAuth.loginPassword({
      phone,
      password,
      uuid: captcha.uuid,
      imageCode
    })
    if (!result.ok) {
      setMessage(result.message)
      void loadCaptcha()
    }
  }

  return (
    <main className="login-page">
      <section className="login-visual" aria-label="因赛AI">
        <div className="login-brand">
          <div className="brand-mark" aria-hidden="true"><img src={brandMark} alt="" /></div>
          <div>
            <strong>因赛AI</strong>
            <span>一站搞掂电商生意</span>
          </div>
        </div>
        <p>让智能工作区、安全会话和业务资产在一个桌面客户端中协同。</p>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <header>
            <h1>欢迎登录</h1>
            <p>登录后进入你的专属工作区</p>
          </header>
          <div className="login-tabs" role="tablist" aria-label="登录方式">
            <button type="button" role="tab" aria-selected={method === 'sms'} onClick={() => setMethod('sms')}>验证码登录</button>
            <button type="button" role="tab" aria-selected={method === 'password'} onClick={() => setMethod('password')}>密码登录</button>
          </div>
          {method === 'sms' ? (
            <form onSubmit={(event) => void submitSms(event)}>
              <label>手机号<input inputMode="numeric" autoComplete="tel" maxLength={11} value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/gu, ''))} placeholder="请输入手机号" /></label>
              <label>验证码<span className="field-with-action"><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, ''))} placeholder="请输入验证码" /><button type="button" onClick={() => void sendCode()} disabled={!validatePhone(phone) || countdown > 0}>{countdown > 0 ? `${countdown} 秒` : '获取验证码'}</button></span></label>
              <Agreement checked={agreed} setChecked={setAgreed} />
              <button className="primary-button" type="submit" disabled={!canSubmitSms({ phone, code, agreed }) || props.busy}>{props.busy ? '正在登录…' : '登录'}</button>
            </form>
          ) : (
            <form onSubmit={(event) => void submitPassword(event)}>
              <label>手机号<input inputMode="numeric" autoComplete="tel" maxLength={11} value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/gu, ''))} placeholder="请输入手机号" /></label>
              <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /></label>
              <label>图形验证码<span className="field-with-captcha"><input value={imageCode} onChange={(event) => setImageCode(event.target.value)} placeholder="请输入图形验证码" />{captcha ? <button type="button" className="captcha-button" onClick={() => void loadCaptcha()} aria-label="刷新图形验证码"><img src={captcha.image} alt="图形验证码" /></button> : <button type="button" onClick={() => void loadCaptcha()} disabled={captchaLoading}>{captchaLoading ? '加载中…' : '重新加载'}</button>}</span></label>
              <Agreement checked={agreed} setChecked={setAgreed} />
              <button className="primary-button" type="submit" disabled={!captcha || !canSubmitPassword({ phone, password, imageCode, uuid: captcha.uuid, agreed }) || props.busy}>{props.busy ? '正在登录…' : '登录'}</button>
            </form>
          )}
          <p className="form-message" aria-live="polite">{message}</p>
        </div>
      </section>
    </main>
  )
}

function Agreement(props: { checked: boolean; setChecked: (checked: boolean) => void }): React.JSX.Element {
  return (
    <label className="agreement">
      <input type="checkbox" checked={props.checked} onChange={(event) => props.setChecked(event.target.checked)} />
      <span>我已阅读并同意用户服务协议和隐私政策</span>
    </label>
  )
}
