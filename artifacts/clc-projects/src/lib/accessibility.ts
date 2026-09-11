export function getLuminance(hex: string) {
  let color = hex.replace(/^#/, '');
  if (color.length === 3) color = color.split('').map(c => c + c).join('');
  if (color.length !== 6) return 0;
  
  const rgb = [
    parseInt(color.substring(0, 2), 16) / 255,
    parseInt(color.substring(2, 4), 16) / 255,
    parseInt(color.substring(4, 6), 16) / 255
  ].map(c => {
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function getContrastRatio(hex1: string, hex2: string) {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const brightest = Math.max(l1, l2);
  const darkest = Math.min(l1, l2);
  return (brightest + 0.05) / (darkest + 0.05);
}
