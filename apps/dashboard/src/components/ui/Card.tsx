/** بطاقة النظام — سطح واحد لكل المقاطع بعنوان صغير موحد */

export function Card(props: { title?: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <section
      className="card"
      style={props.accent === true ? { borderColor: "rgba(251,191,36,.5)" } : undefined}
    >
      {props.title !== undefined && <h2>{props.title}</h2>}
      {props.children}
    </section>
  );
}
