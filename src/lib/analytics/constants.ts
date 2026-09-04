/** Small, explainable heuristics used by collection and admin alerts. */
export const ANALYTICS_THRESHOLDS = {
  activeNowMinutes: 5,
  sessionIdleMinutes: 30,
  skipMinimumSeconds: 3,
  giveUpMinimumSeconds: 30,
  struggleWrongAnswerSeconds: 60,
  struggleLongAnswerSeconds: 120,
  attentionMinimumSamples: 10,
  lowQuestionAccuracyPercent: 45,
  highGiveUpPercent: 20,
  lowVideoCompletionPercent: 35,
} as const;

export const ANALYTICS_STORAGE_KEYS = {
  sessionId: "decodedsat.analytics.session-id",
  lastActivity: "decodedsat.analytics.last-activity",
  identifiedUser: "decodedsat.analytics.identified-user",
  registeredUser: "decodedsat.analytics.registration-tracked",
} as const;
