export interface UpdatePreferences {
  candidateOptIn: boolean
}

export interface AboutUpdateApi {
  preference(): Promise<UpdatePreferences>
  setCandidateOptIn(value: boolean): Promise<UpdatePreferences>
  openCandidateCheck(): Promise<void>
}
