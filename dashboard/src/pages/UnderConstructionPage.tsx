export default function UnderConstructionPage({ title }: { title: string }) {
  return (
    <div>
      <h1 className="page-title">{title}</h1>
      <section className="panel">
        <p>This page is under construction.</p>
      </section>
    </div>
  );
}
