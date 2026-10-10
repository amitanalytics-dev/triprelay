export function money(minor, currency = 'INR') {
  if (!Number.isSafeInteger(minor) || minor < 0 || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return 'Unverified price';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(minor / 100);
}
export function checkedTime(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000) return 'Check time missing';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(value) + ' IST';
}
export function optionLabel(option) { return option === 'balanced' ? 'Balanced option' : 'Lowest-price option'; }
