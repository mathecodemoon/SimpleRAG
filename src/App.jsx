import { useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import Chat from './components/Chat.jsx'

export default function App() {
  const [collapsed, setCollapsed] = useState(false)
  const [session, setSession] = useState(1)

  return (
    <div className="app">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onNewChat={() => setSession((s) => s + 1)}
      />
      <Chat key={session} onToggleSidebar={() => setCollapsed((c) => !c)} />
    </div>
  )
}
