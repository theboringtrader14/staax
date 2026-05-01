/**
 * Shared formatting utilities used across the STAAX frontend.
 *
 * fmtPnl  — Format an INR P&L value with sign prefix and en-IN locale grouping.
 *           e.g. 1234.7 → "+₹1,235"   -500 → "-₹500"
 *
 * getISTNow — Return a Date object representing the current wall-clock time in
 *             IST (Asia/Kolkata, UTC+5:30). Uses the portable
 *             `toLocaleString` round-trip which works in all environments.
 */

/** Format an INR P&L number: rounded, sign-prefixed, en-IN grouped. */
export function fmtPnl(v: number): string {
  const sign = v >= 0 ? '+' : '-'
  return `${sign}₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}`
}

/** Return a Date whose local fields (.getHours(), .getDay(), etc.) reflect IST. */
export function getISTNow(base: Date = new Date()): Date {
  return new Date(base.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
}
