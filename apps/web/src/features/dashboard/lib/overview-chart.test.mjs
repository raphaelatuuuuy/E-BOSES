import assert from "node:assert/strict"
import test from "node:test"

const barHeights = (values) =>
  ((max) => (max <= 0 ? values.map(() => 0) : values.map((v) => (Math.max(0, v) / max) * 88)))(
    Math.max(0, ...values)
  )

const peakIndex = (values) => {
  let best = -1
  let top = 0
  values.forEach((value, index) => {
    if (value > top) {
      top = value
      best = index
    }
  })
  return best
}

const formatDelta = (pct, basis) => {
  if (pct == null || !Number.isFinite(pct)) return null
  if (pct === 0) return `0% ${basis}`
  return `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}% ${basis}`
}

test("peak bar fills to headroom, rest scale proportionally", () => {
  assert.deepEqual(barHeights([50, 100, 25]), [44, 88, 22])
})

test("all-zero week renders flat bars with no peak", () => {
  assert.deepEqual(barHeights([0, 0, 0]), [0, 0, 0])
  assert.equal(peakIndex([0, 0, 0]), -1)
})

test("peak is the first tallest day", () => {
  assert.equal(peakIndex([10, 96, 40, 96]), 1)
})

test("delta arrows point the right way and nulls stay hidden", () => {
  assert.equal(formatDelta(18, "vs last month"), "↑ 18% vs last month")
  assert.equal(formatDelta(-8, "vs last month"), "↓ 8% vs last month")
  assert.equal(formatDelta(0, "vs last month"), "0% vs last month")
  assert.equal(formatDelta(null, "vs last month"), null)
  assert.equal(formatDelta(Number.NaN, "vs last month"), null)
})
