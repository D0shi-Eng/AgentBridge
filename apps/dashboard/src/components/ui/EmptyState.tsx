/** حالة الفراغ المصممة — أيقونة وعنوان وتلميح إجرائي بدل جدول فارغ صامت */

export function EmptyState(props: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="icon" aria-hidden="true">
        {props.icon ?? "◌"}
      </div>
      <div className="title">{props.title}</div>
      {props.hint !== undefined && <div className="hint">{props.hint}</div>}
    </div>
  );
}
