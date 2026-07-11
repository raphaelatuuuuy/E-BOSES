interface AvatarUser {
  avatar?: string | null
  role: string
  gender?: string | null
  date_of_birth?: string | null
  responder_unit?: string | null
}

/**
 * Compute the default avatar key for a user based on role + gender.
 * Used as fallback when user.avatar is empty (e.g. during optimistic UI).
 * The canonical source is the backend get_avatar() serializer method —
 * this only duplicates the logic for instant client-side rendering.
 */
export function computeDefaultAvatar(user: AvatarUser): string {
  if (user.avatar) return user.avatar

  const rolePrefixMap: Record<string, string> = {
    barangay_official: "official",
  }
  const responderUnitMap: Record<string, string> = {
    tanod: "tanod",
    bhw: "bhw",
    bdrrmo: "bdrmmo",
  }

  let prefix: string | undefined
  if (rolePrefixMap[user.role]) {
    prefix = rolePrefixMap[user.role]
  } else if (user.role === "first_responder" && user.responder_unit) {
    prefix = responderUnitMap[user.responder_unit]
  }

  if (prefix) {
    if (user.gender === "male") return `${prefix}-male`
    if (user.gender === "female") return `${prefix}-female`
    return `${prefix}-male`  // fallback when gender unknown
  }

  // Resident fallback: age + gender
  if (user.gender && user.gender !== "prefer_not_to_say" && user.date_of_birth) {
    const age = new Date().getFullYear() - new Date(user.date_of_birth).getFullYear()
    const bucket = age >= 55 ? "senior" : age >= 30 ? "middleaged" : "young"
    const icon = user.gender === "male" ? "man" : "woman"
    return `${bucket}-${icon}`
  }

  return ""
}

/**
 * Role-appropriate avatar choices for the profile avatar picker.
 */
export function getAvatarChoices(role: string, responderUnit?: string): string[] {
  const genders = ["male", "female"]

  const rolePrefixMap: Record<string, string> = {
    barangay_official: "official",
  }
  const responderUnitMap: Record<string, string> = {
    tanod: "tanod",
    bhw: "bhw",
    bdrrmo: "bdrmmo",
  }

  let prefix: string | undefined
  if (rolePrefixMap[role]) {
    prefix = rolePrefixMap[role]
  } else if (role === "first_responder" && responderUnit) {
    prefix = responderUnitMap[responderUnit]
  }

  if (prefix) {
    return genders.map((g) => `${prefix}-${g}`)
  }

  // Resident: age-bucket choices
  const ages = ["young", "middleaged", "senior"]
  const icons = ["man", "woman"]
  return ages.flatMap((a) => icons.map((i) => `${a}-${i}`))
}
