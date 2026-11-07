export function CrackOrder({ items }: { items: string[] }) {
  return (
    <section>
      <h2>Crack order</h2>
      {items.length ? <ol>{items.map((item) => <li key={item}>{item}</li>)}</ol> : <p>No exits recorded yet.</p>}
    </section>
  );
}
