/**
 * Matches text that starts with a command word, for the "Missing ; before" error when a query runs on into the next.
 */
export const startsQueryMatch: RegExp = /^\s*(alter|create|delete|describe|drop|insert|read|show|update|use)(?![a-z0-9_-])/i
