const UserIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)

const SparkIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M18.4 5.6l-2.1 2.1m-8.6 8.6-2.1 2.1" />
  </svg>
)

export default function Message({ role, author, children }) {
  const isUser = role === 'user'
  return (
    <div className={`message message-${role}`}>
      <div className={`message-avatar ${role}`}>
        {isUser ? <UserIcon size={15} /> : <SparkIcon size={15} />}
      </div>
      <div className="message-body">
        <div className="message-author">{author}</div>
        <div className="message-content">{children}</div>
      </div>
    </div>
  )
}
