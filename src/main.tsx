import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
// import TikTokApp from './TikTokApp.tsx' // 2. 引入新的 TikTokApp (注意文件名)
createRoot(document.getElementById('root')!).render(
    <StrictMode>
        { <App /> }
    </StrictMode>
    // <TikTokApp />     

)
