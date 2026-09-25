const CUSTOM_CURRENCY_ICONS: Record<string, string> = {
  usdt: '/img/currencies/usdt.svg',
  usdt_bep20: '/img/currencies/usdt_bep20.svg',
  usdt_trc20: '/img/currencies/usdt_trc20.svg',
  mlc: '/img/currencies/mlc.svg',
};

export function getCurrencyIcon(currencyCode: string): string {
  if (!currencyCode || typeof currencyCode !== 'string') {
    throw new Error('Currency code must be a non-empty string.');
  }

  const formattedCode = currencyCode.trim().toLowerCase();

  if (CUSTOM_CURRENCY_ICONS[formattedCode]) {
    return CUSTOM_CURRENCY_ICONS[formattedCode];
  }

  return `https://wise.com/web-art/assets/flags/${formattedCode}.svg`;
}
