/** جدول بيانات رقيق — أعمدة نصية وصفوف مُصيَّرة خارجياً مع حالة فراغ.
 * الاسم الرسمي `table.list` مطابق لأنماط patterns.css،
 * ويعمل داخل غلاف تمرير أفقي كي لا تكسر الجداول الضيقة الصفحة. */

export interface DataTableColumn {
  readonly key: string;
  readonly header: string;
}

export function DataTable<T>(props: {
  columns: readonly DataTableColumn[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  renderCell: (row: T, columnKey: string) => React.ReactNode;
  empty?: React.ReactNode;
  /** تسمية وصولية للجدول — تُقرأ بقارئ الشاشة */
  ariaLabel?: string;
}) {
  if (props.rows.length === 0 && props.empty !== undefined) {
    return <>{props.empty}</>;
  }
  return (
    <div className="table-scroll">
      <table className="list" aria-label={props.ariaLabel}>
        <thead>
          <tr>
            {props.columns.map((column) => (
              <th key={column.key} scope="col">{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={props.rowKey(row)}>
              {props.columns.map((column) => (
                <td key={column.key}>{props.renderCell(row, column.key)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
