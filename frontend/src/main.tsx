import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { AlgoProvider } from '@/context/AlgoContext'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AlgoProvider>
      <App />
    </AlgoProvider>
  </React.StrictMode>
)
