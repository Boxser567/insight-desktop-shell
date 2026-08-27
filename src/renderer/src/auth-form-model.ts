/** Return whether a phone number is accepted by the existing account service. */
export function validatePhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/u.test(phone)
}

/** Return whether the SMS form has every required field. */
export function canSubmitSms(input: {
  phone: string
  code: string
  agreed: boolean
}): boolean {
  return validatePhone(input.phone) && /^\d{6}$/u.test(input.code) && input.agreed
}

/** Return whether the password form has every required field. */
export function canSubmitPassword(input: {
  phone: string
  password: string
  imageCode: string
  uuid: string
  agreed: boolean
}): boolean {
  return (
    validatePhone(input.phone) &&
    input.password.length > 0 &&
    input.imageCode.length > 0 &&
    input.uuid.length > 0 &&
    input.agreed
  )
}
