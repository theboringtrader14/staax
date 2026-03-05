import { createContext, useContext, useState, ReactNode } from 'react'

export interface AlgoMeta {
  id:        string
  name:      string
  account:   string
  entryTime: string
  exitTime:  string
  legs:      { instCode: string; dir: 'B' | 'S' }[]
}

interface AlgoContextType {
  algos:      AlgoMeta[]
  addAlgo:    (algo: AlgoMeta) => void
  updateAlgo: (id: string, updates: Partial<AlgoMeta>) => void
  removeAlgo: (id: string) => void
}

const AlgoContext = createContext<AlgoContextType | null>(null)

const DEMO_ALGOS: AlgoMeta[] = [
  { id:'1', name:'AWS-1',  account:'Karthik', entryTime:'09:16', exitTime:'15:10', legs:[{instCode:'NF',dir:'B'},{instCode:'NF',dir:'B'}] },
  { id:'2', name:'TF-BUY', account:'Mom',     entryTime:'09:30', exitTime:'15:10', legs:[{instCode:'BN',dir:'B'}] },
  { id:'3', name:'S1',     account:'Karthik', entryTime:'09:20', exitTime:'15:10', legs:[{instCode:'NF',dir:'B'},{instCode:'NF',dir:'S'}] },
  { id:'4', name:'MDS-1',  account:'Mom',     entryTime:'09:30', exitTime:'15:10', legs:[{instCode:'MN',dir:'B'}] },
  { id:'5', name:'Test 1', account:'Karthik', entryTime:'09:16', exitTime:'15:10', legs:[{instCode:'NF',dir:'S'},{instCode:'NF',dir:'S'}] },
]

export function AlgoProvider({ children }: { children: ReactNode }) {
  const [algos, setAlgos] = useState<AlgoMeta[]>(DEMO_ALGOS)

  const addAlgo    = (algo: AlgoMeta) => setAlgos(prev => [...prev, algo])
  const updateAlgo = (id: string, updates: Partial<AlgoMeta>) => setAlgos(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a))
  const removeAlgo = (id: string) => setAlgos(prev => prev.filter(a => a.id !== id))

  return (
    <AlgoContext.Provider value={{ algos, addAlgo, updateAlgo, removeAlgo }}>
      {children}
    </AlgoContext.Provider>
  )
}

export function useAlgos() {
  const ctx = useContext(AlgoContext)
  if (!ctx) throw new Error('useAlgos must be used within AlgoProvider')
  return ctx
}
