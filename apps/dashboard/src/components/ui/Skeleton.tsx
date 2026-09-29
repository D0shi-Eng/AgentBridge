/** هياكل التحميل المؤقتة — خطوط وهمية بوميض هادئ حتى تصل البيانات */

export function SkeletonLine({ width = "100%", height = 14 }: { width?: number | string; height?: number }) {
  return <div className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

/** هيكل بطاقة كامل: عنوان + ثلاثة أسطر متدرجة */
export function SkeletonCard() {
  return (
    <div className="card" aria-busy="true">
      <SkeletonLine width="30%" />
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <SkeletonLine width="90%" height={12} />
        <SkeletonLine width="75%" height={12} />
        <SkeletonLine width="55%" height={12} />
      </div>
    </div>
  );
}
