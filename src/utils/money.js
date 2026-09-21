const MAX_CENTS = 9999999999; // DECIMAL(10,2)
function toCents(value) {
  const text = String(value);
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) throw new RangeError('Invalid money amount');
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) throw new RangeError('Amount exceeds limit');
  return cents;
}
function fromCents(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_CENTS) throw new RangeError('Invalid cents');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
module.exports = { MAX_CENTS, toCents, fromCents };
