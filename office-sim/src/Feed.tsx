export function Feed({ items }: { items: string[] }) {
  return (
    <section>
      <h2>Story feed</h2>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  );
}
