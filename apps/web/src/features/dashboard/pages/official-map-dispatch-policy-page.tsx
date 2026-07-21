import { useEffect, useState, type FormEvent } from "react"
import { ArrowLeftIcon, MapPinnedIcon, SaveIcon, ShieldAlertIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { Button } from "@workspace/ui/components/button"
import {
  getMapDispatchPolicy,
  updateMapDispatchPolicy,
  type MapDispatchPolicy,
} from "@/features/dashboard/api"
import { usePageTitle } from "@/hooks/use-page-title"

type Draft = {
  acceptance_center_latitude: string
  acceptance_center_longitude: string
  acceptance_radius_meters: string
  out_of_zone_action: MapDispatchPolicy["out_of_zone_action"]
  witness_radius_meters: string
  responder_nearby_radius_meters: string
}

function draftFromPolicy(policy: MapDispatchPolicy): Draft {
  return {
    acceptance_center_latitude: String(policy.acceptance_center_latitude),
    acceptance_center_longitude: String(policy.acceptance_center_longitude),
    acceptance_radius_meters: String(policy.acceptance_radius_meters),
    out_of_zone_action: policy.out_of_zone_action,
    witness_radius_meters: String(policy.witness_radius_meters),
    responder_nearby_radius_meters: String(policy.responder_nearby_radius_meters),
  }
}

export default function OfficialMapDispatchPolicyPage() {
  usePageTitle("Map & Dispatch")
  const navigate = useNavigate()
  const [policy, setPolicy] = useState<MapDispatchPolicy | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const next = await getMapDispatchPolicy()
        if (cancelled) return
        setPolicy(next)
        setDraft(draftFromPolicy(next))
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not load map dispatch policy.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    setSaving(true)
    try {
      const saved = await updateMapDispatchPolicy({
        acceptance_center_latitude: Number(draft.acceptance_center_latitude),
        acceptance_center_longitude: Number(draft.acceptance_center_longitude),
        acceptance_radius_meters: Number(draft.acceptance_radius_meters),
        out_of_zone_action: draft.out_of_zone_action,
        witness_radius_meters: Number(draft.witness_radius_meters),
        responder_nearby_radius_meters: Number(draft.responder_nearby_radius_meters),
      })
      setPolicy(saved)
      setDraft(draftFromPolicy(saved))
      toast.success("Map dispatch policy saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save map dispatch policy.")
    } finally {
      setSaving(false)
    }
  }

  function patch(next: Partial<Draft>) {
    setDraft((current) => current ? { ...current, ...next } : current)
  }

  return (
    <main className="min-h-full bg-[#f7f8fc] p-4 pb-28 md:p-6 md:pb-6 lg:p-8">
      <header className="rounded-lg border border-[#dfe7f5] bg-white p-5">
        <button type="button" onClick={() => navigate("/dashboard/alerts-map")} className="flex items-center gap-2 text-xs font-black text-[#2447b3]">
          <ArrowLeftIcon className="size-4" />
          Back to Alert Map
        </button>
        <p className="mt-5 text-[12px] font-black uppercase tracking-wide text-[#ff6a1a]">Configuration</p>
        <h1 className="mt-1 text-2xl font-black text-[#07145f]">Map & Dispatch</h1>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[#68739c]">
          Configure the accepted service zone, witness notification radius, and responder nearby threshold used by concern and SOS workflows.
        </p>
      </header>

      <form onSubmit={save} className="mt-5 grid gap-5 xl:grid-cols-[1fr_22rem]">
        <section className="rounded-lg border border-[#dfe7f5] bg-white p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#eef3ff] text-[#2447b3]">
              <MapPinnedIcon className="size-5" />
            </span>
            <div>
              <h2 className="font-black text-[#07145f]">Acceptance zone</h2>
              <p className="mt-1 text-xs font-semibold leading-5 text-[#68739c]">Used by resident pin validation. You can also adjust the same ring directly on the Alert Map.</p>
            </div>
          </div>

          {loading || !draft ? (
            <p className="mt-6 rounded-lg border border-dashed border-[#cbd8ee] p-5 text-sm font-semibold text-[#68739c]">Loading policy...</p>
          ) : (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <label className="grid gap-1 text-xs font-black uppercase text-[#43507f]">
                Center latitude
                <input required inputMode="decimal" value={draft.acceptance_center_latitude} onChange={(e) => patch({ acceptance_center_latitude: e.target.value })} className="h-11 rounded-lg border border-[#cbd8ee] px-3 text-sm font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
              </label>
              <label className="grid gap-1 text-xs font-black uppercase text-[#43507f]">
                Center longitude
                <input required inputMode="decimal" value={draft.acceptance_center_longitude} onChange={(e) => patch({ acceptance_center_longitude: e.target.value })} className="h-11 rounded-lg border border-[#cbd8ee] px-3 text-sm font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
              </label>
              <label className="grid gap-1 text-xs font-black uppercase text-[#43507f]">
                Acceptance radius
                <input required type="number" min={100} max={5000} value={draft.acceptance_radius_meters} onChange={(e) => patch({ acceptance_radius_meters: e.target.value })} className="h-11 rounded-lg border border-[#cbd8ee] px-3 text-sm font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
              </label>
              <label className="grid gap-1 text-xs font-black uppercase text-[#43507f]">
                Out-of-zone action
                <select value={draft.out_of_zone_action} onChange={(e) => patch({ out_of_zone_action: e.target.value as Draft["out_of_zone_action"] })} className="h-11 rounded-lg border border-[#cbd8ee] px-3 text-sm font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]">
                  <option value="review">Flag for official review</option>
                  <option value="warn">Warn and allow</option>
                  <option value="block">Block submission</option>
                </select>
              </label>
            </div>
          )}
        </section>

        <aside className="grid gap-5">
          <section className="rounded-lg border border-[#dfe7f5] bg-white p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#fff1ea] text-[#ff6a1a]">
                <ShieldAlertIcon className="size-5" />
              </span>
              <div>
                <h2 className="font-black text-[#07145f]">Response thresholds</h2>
                <p className="mt-1 text-xs font-semibold leading-5 text-[#68739c]">These values affect live notifications and responder status changes.</p>
              </div>
            </div>

            {draft ? (
              <div className="mt-5 grid gap-4">
                <label className="grid gap-1 text-xs font-black uppercase text-[#43507f]">
                  Witness radius
                  <input required type="number" min={50} max={3000} value={draft.witness_radius_meters} onChange={(e) => patch({ witness_radius_meters: e.target.value })} className="h-11 rounded-lg border border-[#cbd8ee] px-3 text-sm font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
                </label>
                <label className="grid gap-1 text-xs font-black uppercase text-[#43507f]">
                  Responder nearby radius
                  <input required type="number" min={10} max={1000} value={draft.responder_nearby_radius_meters} onChange={(e) => patch({ responder_nearby_radius_meters: e.target.value })} className="h-11 rounded-lg border border-[#cbd8ee] px-3 text-sm font-semibold text-[#07145f] outline-none focus:border-[#ff6a1a]" />
                </label>
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-[#dfe7f5] bg-white p-5">
            <p className="text-xs font-black uppercase text-[#68739c]">Current policy</p>
            <p className="mt-2 text-sm font-black text-[#07145f]">{policy?.barangay || "Marikina Heights"}</p>
            <p className="mt-1 text-xs font-semibold text-[#68739c]">{policy?.updated_at ? `Updated ${new Date(policy.updated_at).toLocaleString()}` : "Using defaults"}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="submit" disabled={saving || loading || !draft} className="rounded-md bg-[#07145f] text-white hover:bg-[#0d217e]">
                <SaveIcon className="size-4" />
                Save policy
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate("/dashboard/alerts-map")} className="rounded-md border-[#cbd8ee]">
                Preview map
              </Button>
            </div>
          </section>
        </aside>
      </form>
    </main>
  )
}
