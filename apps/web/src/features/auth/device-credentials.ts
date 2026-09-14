import { Capacitor, registerPlugin } from "@capacitor/core"

interface SavedCredentialsPlugin {
  savePassword(options: { id: string; password: string }): Promise<void>
  getPassword(): Promise<{ id: string; password: string }>
}

const SavedCredentials = registerPlugin<SavedCredentialsPlugin>("SavedCredentials")

export function canUseDeviceCredentials() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"
}

export async function saveDevicePassword(id: string, password: string) {
  if (!canUseDeviceCredentials()) return
  await SavedCredentials.savePassword({ id, password })
}

export async function getDevicePassword() {
  if (!canUseDeviceCredentials()) return null
  return SavedCredentials.getPassword()
}

function getPasswordCredentialCtor(): (new (data: { id: string; password: string }) => Credential) | null {
  if (typeof window === "undefined") return null
  const ctor = (window as unknown as Record<string, unknown>).PasswordCredential
  return typeof ctor === "function"
    ? (ctor as new (data: { id: string; password: string }) => Credential)
    : null
}

export function canUseWebCredentials() {
  return (
    typeof navigator !== "undefined" &&
    "credentials" in navigator &&
    getPasswordCredentialCtor() !== null
  )
}

export async function saveWebPassword(id: string, password: string) {
  const PasswordCredential = getPasswordCredentialCtor()
  if (!PasswordCredential || !password) return
  await navigator.credentials.store(new PasswordCredential({ id, password }))
}

export async function getWebPassword() {
  if (!canUseWebCredentials()) return null
  const credential = (await navigator.credentials.get({
    password: true,
    mediation: "optional",
  } as CredentialRequestOptions)) as { id?: string; password?: string } | null
  if (!credential || !credential.id || !credential.password) return null
  return { id: credential.id, password: credential.password }
}
