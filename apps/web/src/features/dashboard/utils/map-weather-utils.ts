export function weatherLabel(code: number | null) {
  if (code == null) return "Local weather"
  if (code === 0) return "Clear sky"
  if ([1, 2, 3].includes(code)) return "Partly cloudy"
  if ([45, 48].includes(code)) return "Foggy"
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle"
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rainy"
  if ([95, 96, 99].includes(code)) return "Thunderstorms"
  return "Cloudy"
}
