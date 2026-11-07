export function Chart({ data }: { data: Array<Record<string, number>> }) {
  return (
    <section>
      <h2>Office chart</h2>
      <div>{data.length ? 'Chart data placeholder' : 'No chart data yet'}</div>
    </section>
  );
}
