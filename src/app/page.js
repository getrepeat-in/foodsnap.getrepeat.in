export default function Home() {
  return (
    <main style={{ padding: "40px", fontFamily: "monospace" }}>
      <h1>FoodSnap Search API</h1>
      <p>Status: Online</p>
      <ul>
        <li>
          GET <code>/api/search?q=butter+chicken&limit=12&page=1</code>
        </li>
        <li>
          GET <code>/api/image/search?q=steam+momo&limit=12&page=1</code>
        </li>
      </ul>
    </main>
  );
}
