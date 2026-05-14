import {
  createChart,
  IChartApi,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
} from 'lightweight-charts'
import { useEffect, useRef, useState } from 'react'

interface BotChartProps {
  botId: string
  timeframeMins: number
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function BotChart({ botId, timeframeMins }: BotChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 320,
      layout: { background: { color: '#0d1117' }, textColor: '#9ca3af' },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.1)', timeVisible: true },
    })
    chartRef.current = chart

    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) localStorage.setItem('botChart_range', JSON.stringify(range))
    })

    const candles  = chart.addSeries(CandlestickSeries, {
      upColor: '#0EA66E', downColor: '#FF4444',
      borderUpColor: '#0EA66E', borderDownColor: '#FF4444',
      wickUpColor: '#0EA66E', wickDownColor: '#FF4444',
    })
    const upperBand = chart.addSeries(LineSeries, { color: '#38bdf8', lineWidth: 1, title: 'Upper' })
    const lowerBand = chart.addSeries(LineSeries, { color: '#f87171', lineWidth: 1, title: 'Lower' })
    const midLine   = chart.addSeries(LineSeries, { color: 'rgba(255,255,255,0.3)', lineWidth: 1, lineStyle: 2, title: 'Mid' })

    const IST_OFFSET = 19800 // UTC+5:30 in seconds

    const fetchData = async () => {
      setLoading(true)
      try {
        const r = await fetch(`${API_BASE}/api/v1/bots/${botId}/chart?timeframe=${timeframeMins}&days=30`)
        if (!r.ok) throw new Error('no data')
        const d = await r.json()
        if (d.candles?.length) candles.setData(d.candles.map((c: any) => ({ ...c, time: (c.time as number) + IST_OFFSET })))
        if (d.upper?.length)   upperBand.setData(d.upper.map((c: any) => ({ ...c, time: (c.time as number) + IST_OFFSET })))
        if (d.lower?.length)   lowerBand.setData(d.lower.map((c: any) => ({ ...c, time: (c.time as number) + IST_OFFSET })))
        if (d.mid?.length)     midLine.setData(d.mid.map((c: any) => ({ ...c, time: (c.time as number) + IST_OFFSET })))
        if (d.entries?.length) {
          createSeriesMarkers(candles, (d.entries as any[]).map((e) => {
            const dir = e.direction?.toLowerCase()
            return {
              time: ((e.time as number) + IST_OFFSET) as import('lightweight-charts').Time,
              position: dir === 'sell' ? 'aboveBar' : 'belowBar',
              color: dir === 'sell' ? '#ef4444' : '#22c55e',
              shape: dir === 'sell' ? 'arrowDown' : 'arrowUp',
              text: dir === 'sell' ? 'SELL' : 'BUY',
            }
          }))
        }
        const savedRange = localStorage.getItem('botChart_range')
        if (savedRange) {
          chart.timeScale().setVisibleLogicalRange(JSON.parse(savedRange))
        } else {
          chart.timeScale().fitContent()
        }
      } catch (e) {
        console.warn('[BotChart] chart data fetch failed', e)
      }
      setLoading(false)
    }
    fetchData()

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, 320)
    })
    ro.observe(containerRef.current)
    return () => { chart.remove(); ro.disconnect() }
  }, [botId, timeframeMins])

  return (
    <div style={{ position: 'relative', padding: '12px 20px 16px' }}>
      {loading && (
        <div style={{ position: 'absolute', top: 16, right: 28, fontSize: 10, color: '#6b7280', fontFamily: 'monospace', zIndex: 1 }}>Loading…</div>
      )}
      <div style={{ borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--neu-inset)', position: 'relative' }}>
        <div ref={containerRef} style={{ width: '100%', height: 320 }} />
        <button
          onClick={() => {
            chartRef.current?.timeScale().fitContent()
            localStorage.removeItem('botChart_range')
          }}
          style={{
            position: 'absolute', top: 8, right: 8,
            background: 'var(--bg)', border: 'none',
            boxShadow: 'var(--neu-raised-sm)',
            borderRadius: 8, padding: '4px 10px',
            color: 'var(--text-dim)', fontSize: 11,
            cursor: 'pointer', zIndex: 10,
          }}
        >⊡ Reset</button>
      </div>
    </div>
  )
}
