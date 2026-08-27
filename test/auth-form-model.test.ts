import { describe, expect, it } from 'vitest'
import {
  canSubmitPassword,
  canSubmitSms,
  validatePhone
} from '../src/renderer/src/auth-form-model'

describe('desktop login form model', () => {
  it('accepts only supported mainland mobile numbers', () => {
    expect(validatePhone('13800138000')).toBe(true)
    expect(validatePhone('23800138000')).toBe(false)
    expect(validatePhone('1380013800')).toBe(false)
  })

  it('requires phone, code and agreement for SMS login', () => {
    expect(
      canSubmitSms({ phone: '13800138000', code: '123456', agreed: true })
    ).toBe(true)
    expect(
      canSubmitSms({ phone: '13800138000', code: '', agreed: true })
    ).toBe(false)
    expect(
      canSubmitSms({ phone: '13800138000', code: '123456', agreed: false })
    ).toBe(false)
  })

  it('requires captcha identity and agreement for password login', () => {
    expect(
      canSubmitPassword({
        phone: '13800138000',
        password: 'secret123',
        imageCode: 'abcd',
        uuid: 'captcha-uuid',
        agreed: true
      })
    ).toBe(true)
    expect(
      canSubmitPassword({
        phone: '13800138000',
        password: 'secret123',
        imageCode: 'abcd',
        uuid: '',
        agreed: true
      })
    ).toBe(false)
  })
})
