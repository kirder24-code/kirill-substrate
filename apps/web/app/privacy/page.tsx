export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 700, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui, sans-serif", color: "#e0e0e0", background: "#0a0a0a", minHeight: "100vh" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Privacy Policy</h1>
      <p style={{ color: "#888", marginBottom: 24 }}>Last updated: April 23, 2026</p>

      <h2 style={{ fontSize: 20, marginTop: 24 }}>What we collect</h2>
      <p>When you interact with LaunchSoloAI services or our Threads integration (CortexThreads), we may access:</p>
      <ul>
        <li>Your public Threads profile information (username, bio)</li>
        <li>Your public Threads posts and replies</li>
        <li>Post engagement metrics (likes, replies, reposts)</li>
      </ul>

      <h2 style={{ fontSize: 20, marginTop: 24 }}>How we use it</h2>
      <ul>
        <li>To monitor and respond to comments on our own posts</li>
        <li>To analyze engagement for content improvement</li>
        <li>To publish posts and replies on behalf of the account owner</li>
      </ul>

      <h2 style={{ fontSize: 20, marginTop: 24 }}>What we don't do</h2>
      <ul>
        <li>We do not sell or share your data with third parties</li>
        <li>We do not store private messages</li>
        <li>We do not access private or non-public content</li>
      </ul>

      <h2 style={{ fontSize: 20, marginTop: 24 }}>Data storage</h2>
      <p>Data is stored locally on secured infrastructure in Calgary, Canada. No cloud storage of personal data.</p>

      <h2 style={{ fontSize: 20, marginTop: 24 }}>Contact</h2>
      <p>Kirill D. - <a href="mailto:kirill@launchsoloai.com" style={{ color: "#60a5fa" }}>kirill@launchsoloai.com</a></p>
      <p>Calgary, Alberta, Canada</p>

      <h2 style={{ fontSize: 20, marginTop: 24 }}>Data deletion</h2>
      <p>To request deletion of your data, email kirill@launchsoloai.com. We will process your request within 30 days.</p>
    </div>
  );
}
