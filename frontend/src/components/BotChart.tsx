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
  symbol: string
  timeframe?: string
  indicators?: Record<string, any>
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function BotChart({ botId, symbol, timeframe: initTf = '5m' }: BotChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const [tf, setTf] = useState(initTf)
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

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#0EA66E', downColor: '#FF4444',
      borderUpColor: '#0EA66E', borderDownColor: '#FF4444',
      wickUpColor: '#0EA66E', wickDownColor: '#FF4444',
    })
    const upperBand = chart.addSeries(LineSeries, { color: '#38bdf8', lineWidth: 1, title: 'Upper' })
    const lowerBand = chart.addSeries(LineSeries, { color: '#f87171', lineWidth: 1, title: 'Lower' })
    const midLine   = chart.addSeries(LineSeries, { color: 'rgba(255,255,255,0.3)', lineWidth: 1, lineStyle: 2, title: 'Mid' })

    const fetchData = async () => {
      setLoading(true)
      try {
        const r = await fetch(`${API_BASE}/api/v1/bots/${botId}/chart?timeframe=${tf}&symbol=${symbol}`)
        if (!r.ok) throw new Error('no data')
        const d = await r.json()
        if (d.candles?.length) candles.setData(d.candles)
        if (d.upper?.length)   upperBand.setData(d.upper)
        if (d.lower?.length)   lowerBand.setData(d.lower)
        if (d.mid?.length)     midLine.setData(d.mid)
        if (d.entries?.length) {
          createSeriesMarkers(candles, (d.entries as any[]).map((e) => ({
            time: e.time,
            position: e.direction === 'sell' ? 'aboveBar' : 'belowBar',
            color: e.direction === 'sell' ? '#FF4444' : '#0EA66E',
            shape: 'arrowDown',
            text: e.label || (e.direction === 'sell' ? 'S' : 'B'),
          })))
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
  }, [botId, tf, symbol])

  const timeframes = ['1m', '3m', '5m', '15m', '1h']
  return (
    <div style={{ background: '#0a0e14', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace', marginRight: 8 }}>TIMEFRAME</span>
        {timeframes.map(t => (
          <button key={t} onClick={() => setTf(t)} style={{
            fontSize: 10, fontFamily: 'monospace', padding: '2px 10px', borderRadius: 4,
            border: `1px solid ${tf === t ? 'rgba(45,212,191,0.4)' : 'rgba(255,255,255,0.1)'}`,
            background: tf === t ? 'rgba(45,212,191,0.1)' : 'transparent',
            color: tf === t ? '#2dd4bf' : '#6b7280', cursor: 'pointer',
          }}>{t}</button>
        ))}
        {loading && <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 8 }}>Loading...</span>}
        <span style={{ fontSize: 9, color: '#374151', marginLeft: 'auto', fontFamily: 'monospace' }}>Cross-ref with TradingView</span>
      </div>
      <div ref={containerRef} style={{ width: '100%', height: 320 }} />
    </div>
  )
}
