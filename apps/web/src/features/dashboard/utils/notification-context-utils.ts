import { apiRequest } from "@/lib/api"
import type { Concern } from "@/features/dashboard/api"

export async function fetchConcern(id: number): Promise<Concern> {
  return apiRequest<Concern>(`/concerns/${id}/`)
}
