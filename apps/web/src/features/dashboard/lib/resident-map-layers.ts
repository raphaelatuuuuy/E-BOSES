export type ResidentMapLayers = {
  concerns: boolean
  emergencies: boolean
  advisories: boolean
}

export const defaultResidentLayers: ResidentMapLayers = {
  concerns: true,
  emergencies: true,
  advisories: true,
}
